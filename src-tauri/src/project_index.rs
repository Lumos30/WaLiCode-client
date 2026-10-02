//! Bounded, incremental lexical index for the currently authorized desktop workspace.

use crate::workspace_file::WorkspaceRegistry;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

const MAX_FILES: usize = 5_000;
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_INDEX_BYTES: u64 = 32_000_000;
const MAX_RESULTS: usize = 12;
const MAX_SNIPPET_CHARS: usize = 2_000;
const MAX_TOTAL_SNIPPET_CHARS: usize = 12_000;
const MAX_DEPTH: usize = 32;
const VECTOR_DIMENSIONS: usize = 64;
const MIN_VECTOR_SIMILARITY: f64 = 0.18;

const ALWAYS_IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".idea",
    ".next",
    ".vscode",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
];

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "bat",
    "c",
    "cc",
    "cfg",
    "conf",
    "cpp",
    "cs",
    "css",
    "go",
    "gradle",
    "h",
    "hpp",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "kts",
    "md",
    "mjs",
    "ps1",
    "py",
    "properties",
    "rs",
    "scss",
    "sh",
    "sql",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml",
];

#[derive(Default)]
pub(crate) struct ProjectIndexRegistry {
    current: Mutex<Option<ProjectIndex>>,
}

impl ProjectIndexRegistry {
    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "本地项目索引状态不可用".to_string())?;
        *current = None;
        Ok(())
    }
}

struct ProjectIndex {
    workspace_id: String,
    generation: u64,
    files: BTreeMap<String, IndexedFile>,
}

struct IndexedFile {
    size: u64,
    modified_nanos: u128,
    content_hash: String,
    chunks: Vec<IndexedChunk>,
}

struct IndexedChunk {
    line_start: usize,
    line_end: usize,
    content: String,
    content_hash: String,
    vector: [u16; VECTOR_DIMENSIONS],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRetrievalResult {
    index_version: String,
    files_indexed: usize,
    files_changed: usize,
    files_removed: usize,
    evidence: Vec<ProjectEvidence>,
    truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEvidence {
    path: String,
    line_start: usize,
    line_end: usize,
    snippet: String,
    content_hash: String,
    score: u64,
}

#[tauri::command]
pub fn retrieve_local_project_context(
    workspace_id: String,
    query: String,
    max_results: Option<usize>,
    workspaces: State<'_, WorkspaceRegistry>,
    indexes: State<'_, ProjectIndexRegistry>,
) -> Result<ProjectRetrievalResult, String> {
    if query.trim().is_empty() {
        return Err("项目检索查询不能为空".to_string());
    }
    let root = workspaces.resolve(&workspace_id)?;
    retrieve_at_root(
        &root,
        &workspace_id,
        &query,
        max_results.unwrap_or(8).clamp(1, MAX_RESULTS),
        &indexes,
    )
}

fn retrieve_at_root(
    root: &Path,
    workspace_id: &str,
    query: &str,
    max_results: usize,
    indexes: &ProjectIndexRegistry,
) -> Result<ProjectRetrievalResult, String> {
    let ignore_rules = load_root_ignore_rules(root);
    let mut discovered = Vec::new();
    let mut discovery_truncated = false;
    discover_files(
        root,
        root,
        0,
        &ignore_rules,
        &mut discovered,
        &mut discovery_truncated,
    )?;

    let mut current = indexes
        .current
        .lock()
        .map_err(|_| "本地项目索引状态不可用".to_string())?;
    if current
        .as_ref()
        .is_none_or(|index| index.workspace_id != workspace_id)
    {
        *current = Some(ProjectIndex {
            workspace_id: workspace_id.to_string(),
            generation: 0,
            files: BTreeMap::new(),
        });
    }
    let index = current.as_mut().expect("project index initialized");
    let previously_indexed: HashSet<String> = index.files.keys().cloned().collect();

    let mut files_changed = 0;
    let mut indexed_bytes = 0u64;
    let mut accepted_paths = HashSet::new();
    for file in discovered {
        if indexed_bytes.saturating_add(file.size) > MAX_INDEX_BYTES {
            discovery_truncated = true;
            break;
        }
        indexed_bytes += file.size;
        accepted_paths.insert(file.relative.clone());
        let content = match fs::read_to_string(&file.absolute) {
            Ok(content) if !content.contains('\0') => content,
            _ => {
                index.files.remove(&file.relative);
                continue;
            }
        };
        // File metadata is a useful fast diagnostic, but it is not a content
        // identity.  Editors and source-control operations can preserve both
        // length and timestamps.  The bounded index therefore fingerprints the
        // actual UTF-8 text before deciding to reuse chunks.
        let content_hash = content_fingerprint(&content);
        let unchanged = index.files.get(&file.relative).is_some_and(|existing| {
            existing.size == file.size
                && existing.modified_nanos == file.modified_nanos
                && existing.content_hash == content_hash
        });
        if unchanged {
            continue;
        }
        let chunks = chunk_file(&file.relative, &content);
        index.files.insert(
            file.relative,
            IndexedFile {
                size: file.size,
                modified_nanos: file.modified_nanos,
                content_hash,
                chunks,
            },
        );
        files_changed += 1;
    }
    index.files.retain(|path, _| accepted_paths.contains(path));
    let files_removed = previously_indexed
        .iter()
        .filter(|path| !index.files.contains_key(*path))
        .count();
    if files_changed > 0 || files_removed > 0 || index.generation == 0 {
        index.generation += 1;
    }

    let terms = query_terms(query);
    let normalized_query = query.trim().to_lowercase();
    let query_vector = hashed_text_vector(&normalized_query);
    let mut candidates = Vec::new();
    for (path, file) in &index.files {
        let path_lower = path.to_lowercase();
        for chunk in &file.chunks {
            let content_lower = chunk.content.to_lowercase();
            let lexical = lexical_score(&normalized_query, &terms, &path_lower, &content_lower);
            let vector_similarity = cosine_similarity(&query_vector, &chunk.vector);
            // Retrieval stays explainable: exact/path terms dominate, while a
            // deterministic local vector score can recall related fragments
            // when tokenization differs (notably for CJK source comments).
            let score = lexical + (vector_similarity * 24.0).round() as u64;
            if lexical > 0 || vector_similarity >= MIN_VECTOR_SIMILARITY {
                candidates.push(ProjectEvidence {
                    path: path.clone(),
                    line_start: chunk.line_start,
                    line_end: chunk.line_end,
                    snippet: truncate_chars(&chunk.content, MAX_SNIPPET_CHARS),
                    content_hash: chunk.content_hash.clone(),
                    score,
                });
            }
        }
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.line_start.cmp(&right.line_start))
    });

    let candidate_count = candidates.len();
    let mut total_chars: usize = 0;
    let mut evidence = Vec::new();
    let mut seen_sources = HashSet::new();
    for candidate in candidates {
        // Overlapping chunks can become byte-identical in repetitive generated
        // files. Keep the highest-ranked one and reserve prompt budget for a
        // different fragment.
        let identity = format!("{}:{}", candidate.path, candidate.content_hash);
        if !seen_sources.insert(identity) {
            continue;
        }
        if evidence.len() >= max_results
            || total_chars.saturating_add(candidate.snippet.chars().count())
                > MAX_TOTAL_SNIPPET_CHARS
        {
            break;
        }
        total_chars += candidate.snippet.chars().count();
        evidence.push(candidate);
    }

    Ok(ProjectRetrievalResult {
        index_version: index_version(index),
        files_indexed: index.files.len(),
        files_changed,
        files_removed,
        truncated: discovery_truncated || evidence.len() < candidate_count,
        evidence,
    })
}

struct DiscoveredFile {
    absolute: PathBuf,
    relative: String,
    size: u64,
    modified_nanos: u128,
}

fn discover_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    ignore_rules: &[IgnoreRule],
    files: &mut Vec<DiscoveredFile>,
    truncated: &mut bool,
) -> Result<(), String> {
    if depth > MAX_DEPTH || files.len() >= MAX_FILES {
        *truncated = true;
        return Ok(());
    }
    let mut entries: Vec<_> = match fs::read_dir(directory) {
        Ok(entries) => entries.filter_map(Result::ok).collect(),
        Err(_) if depth == 0 => return Err("无法读取本地项目目录".to_string()),
        Err(_) => {
            *truncated = true;
            return Ok(());
        }
    };
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if files.len() >= MAX_FILES {
            *truncated = true;
            break;
        }
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
            _ => continue,
        };
        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if is_ignored(&relative, metadata.is_dir(), ignore_rules) {
            continue;
        }
        if metadata.is_dir() {
            discover_files(root, &path, depth + 1, ignore_rules, files, truncated)?;
        } else if metadata.is_file()
            && metadata.len() <= MAX_FILE_BYTES
            && is_supported_text_path(&path)
        {
            let modified_nanos = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            files.push(DiscoveredFile {
                absolute: path,
                relative,
                size: metadata.len(),
                modified_nanos,
            });
        }
    }
    Ok(())
}

fn is_supported_text_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    if name.starts_with(".env")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name == "id_rsa"
        || name == "id_ed25519"
    {
        return false;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

#[derive(Clone)]
struct IgnoreRule {
    pattern: String,
    negated: bool,
    directory_only: bool,
}

fn load_root_ignore_rules(root: &Path) -> Vec<IgnoreRule> {
    let content = fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let negated = trimmed.starts_with('!');
            let pattern = trimmed
                .strip_prefix('!')
                .unwrap_or(trimmed)
                .trim_start_matches('/')
                .trim_end_matches('/')
                .replace('\\', "/");
            (!pattern.is_empty()).then_some(IgnoreRule {
                pattern,
                negated,
                directory_only: trimmed.ends_with('/'),
            })
        })
        .collect()
}

fn is_ignored(relative: &str, is_directory: bool, rules: &[IgnoreRule]) -> bool {
    let components: Vec<_> = relative.split('/').collect();
    if components.iter().any(|component| {
        ALWAYS_IGNORED_DIRECTORIES
            .iter()
            .any(|ignored| component.eq_ignore_ascii_case(ignored))
    }) {
        return true;
    }
    let mut ignored = false;
    for rule in rules {
        if rule.directory_only && !is_directory {
            continue;
        }
        let matches = if rule.pattern.contains('/') {
            wildcard_match(&rule.pattern, relative)
                || relative.starts_with(&(rule.pattern.clone() + "/"))
        } else {
            components
                .iter()
                .any(|component| wildcard_match(&rule.pattern, component))
        };
        if matches {
            ignored = !rule.negated;
        }
    }
    ignored
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    for token in pattern {
        let mut current = vec![false; value.len() + 1];
        if token == '*' {
            current[0] = previous[0];
            for index in 1..=value.len() {
                current[index] = previous[index] || current[index - 1];
            }
        } else {
            for index in 1..=value.len() {
                current[index] = previous[index - 1]
                    && (token == '?' || token.eq_ignore_ascii_case(&value[index - 1]));
            }
        }
        previous = current;
    }
    previous[value.len()]
}

fn chunk_file(path: &str, content: &str) -> Vec<IndexedChunk> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        // Keep documentation sections intact where possible, so an evidence
        // citation carries its heading and surrounding explanation.
        "md" | "txt" => chunk_text(content, 120, 8, is_document_boundary),
        // Configuration is usually organised around top-level keys.  Smaller
        // chunks avoid pulling an unrelated service section into the prompt.
        "yaml" | "yml" | "json" | "toml" | "properties" | "xml" | "conf" | "cfg" => {
            chunk_text(content, 60, 4, is_config_boundary)
        }
        // Source chunks prefer symbol-like starts, while retaining an upper
        // bound so large generated-looking methods cannot consume the budget.
        _ => chunk_text(content, 100, 12, is_code_boundary),
    }
}

fn chunk_text(
    content: &str,
    max_lines: usize,
    overlap: usize,
    preferred_boundary: fn(&str) -> bool,
) -> Vec<IndexedChunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let hard_end = (start + max_lines).min(lines.len());
        let min_end = (start + max_lines / 2).min(hard_end);
        let end = (min_end..hard_end)
            .rev()
            .find(|candidate| preferred_boundary(lines[*candidate]))
            .unwrap_or(hard_end);
        let chunk_content = lines[start..end].join("\n");
        chunks.push(IndexedChunk {
            line_start: start + 1,
            line_end: end,
            content_hash: format!("fnv1a64:{:016x}", fnv1a64(chunk_content.as_bytes())),
            vector: hashed_text_vector(&chunk_content),
            content: chunk_content,
        });
        if end == lines.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    chunks
}

fn is_document_boundary(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with('#') || trimmed.starts_with("---")
}

fn is_config_boundary(line: &str) -> bool {
    let trimmed = line.trim_start();
    (!line.starts_with(char::is_whitespace) && trimmed.contains(':'))
        || trimmed.starts_with('[')
        || trimmed.starts_with('<')
}

fn is_code_boundary(line: &str) -> bool {
    let trimmed = line.trim_start();
    [
        "class ",
        "interface ",
        "enum ",
        "record ",
        "fn ",
        "pub fn ",
        "async fn ",
        "function ",
        "export function ",
        "export class ",
        "def ",
        "func ",
        "type ",
        "describe(",
        "it(",
        "test(",
        "#[test]",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

fn query_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut ascii = String::new();
    for character in query.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            ascii.push(character);
        } else {
            if ascii.len() >= 2 {
                terms.push(std::mem::take(&mut ascii));
            } else {
                ascii.clear();
            }
            if !character.is_ascii() && !character.is_whitespace() {
                terms.push(character.to_string());
            }
        }
    }
    if ascii.len() >= 2 {
        terms.push(ascii);
    }
    terms.sort();
    terms.dedup();
    terms.into_iter().take(24).collect()
}

fn lexical_score(query: &str, terms: &[String], path: &str, content: &str) -> u64 {
    let mut score = if !query.is_empty() && content.contains(query) {
        30
    } else {
        0
    };
    for term in terms {
        if path.contains(term) {
            score += 12;
        }
        score += (content.matches(term).count().min(8) as u64) * 2;
    }
    score
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        truncated + "\n...[snippet truncated]"
    } else {
        truncated
    }
}

fn index_version(index: &ProjectIndex) -> String {
    let mut fingerprint = Vec::new();
    for (path, file) in &index.files {
        fingerprint.extend_from_slice(path.as_bytes());
        fingerprint.extend_from_slice(&file.size.to_le_bytes());
        fingerprint.extend_from_slice(&file.modified_nanos.to_le_bytes());
        fingerprint.extend_from_slice(file.content_hash.as_bytes());
    }
    format!(
        "local-hybrid-v1-{}-{:016x}",
        index.generation,
        fnv1a64(&fingerprint)
    )
}

fn content_fingerprint(content: &str) -> String {
    format!("fnv1a64:{:016x}", fnv1a64(content.as_bytes()))
}

/// Small, deterministic feature-hash vector.  It deliberately runs entirely
/// on the desktop and is not an embedding model: no source file leaves the
/// selected workspace until the bounded evidence snapshot is sent to the API.
fn hashed_text_vector(value: &str) -> [u16; VECTOR_DIMENSIONS] {
    let normalized: Vec<char> = value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric() || !character.is_ascii())
        .collect();
    let mut vector = [0u16; VECTOR_DIMENSIONS];
    if normalized.is_empty() {
        return vector;
    }
    for width in 1..=3 {
        if normalized.len() < width {
            continue;
        }
        for window in normalized.windows(width) {
            let mut bytes = Vec::with_capacity(width * 4);
            for character in window {
                let mut encoded = [0u8; 4];
                bytes.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
            }
            let bucket = (fnv1a64(&bytes) as usize) % VECTOR_DIMENSIONS;
            vector[bucket] = vector[bucket].saturating_add(1);
        }
    }
    vector
}

fn cosine_similarity(left: &[u16; VECTOR_DIMENSIONS], right: &[u16; VECTOR_DIMENSIONS]) -> f64 {
    let mut dot = 0u64;
    let mut left_norm = 0u64;
    let mut right_norm = 0u64;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        let left_value = u64::from(*left_value);
        let right_value = u64::from(*right_value);
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm == 0 || right_norm == 0 {
        return 0.0;
    }
    dot as f64 / ((left_norm as f64).sqrt() * (right_norm as f64).sqrt())
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn test_root() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("walicode-index-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn honors_ignore_rules_and_returns_line_references() {
        let root = test_root();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join(".gitignore"), "ignored.rs\n").unwrap();
        fs::write(
            root.join("src/app.rs"),
            "fn start() {}\nfn target_symbol() {}\n",
        )
        .unwrap();
        fs::write(root.join("ignored.rs"), "target_symbol").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "target_symbol").unwrap();

        let registry = ProjectIndexRegistry::default();
        let result = retrieve_at_root(&root, "workspace", "target_symbol", 8, &registry).unwrap();

        assert_eq!(result.files_indexed, 1);
        assert_eq!(result.evidence.len(), 1);
        assert_eq!(result.evidence[0].path, "src/app.rs");
        assert_eq!(result.evidence[0].line_start, 1);
        assert!(result.evidence[0].line_end >= 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refreshes_only_changed_files_and_removes_deleted_entries() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("first.rs"), "alpha_symbol").unwrap();
        fs::write(root.join("second.rs"), "beta_symbol").unwrap();
        let registry = ProjectIndexRegistry::default();

        let first = retrieve_at_root(&root, "workspace", "alpha_symbol", 8, &registry).unwrap();
        let second = retrieve_at_root(&root, "workspace", "alpha_symbol", 8, &registry).unwrap();
        fs::remove_file(root.join("second.rs")).unwrap();
        let third = retrieve_at_root(&root, "workspace", "alpha_symbol", 8, &registry).unwrap();

        assert_eq!(first.files_changed, 2);
        assert_eq!(second.files_changed, 0);
        assert_eq!(third.files_removed, 1);
        assert_ne!(second.index_version, third.index_version);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fingerprints_same_length_content_changes_before_reusing_chunks() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("same-length.rs");
        fs::write(&source, "first_symbol").unwrap();
        let registry = ProjectIndexRegistry::default();

        let first = retrieve_at_root(&root, "workspace", "first_symbol", 8, &registry).unwrap();
        // The replacement has exactly the same byte length.  The content
        // fingerprint, rather than metadata alone, must invalidate chunks.
        fs::write(&source, "other_symbol").unwrap();
        let second = retrieve_at_root(&root, "workspace", "other_symbol", 8, &registry).unwrap();

        assert_eq!(first.evidence.len(), 1);
        assert_eq!(second.files_changed, 1);
        assert_eq!(second.evidence[0].snippet, "other_symbol");
        assert_ne!(first.index_version, second.index_version);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn local_hybrid_score_can_rank_a_related_fragment_without_exact_phrase() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("context.rs"),
            "// assemble repository context before calling the model\nfn assemble_context() {}",
        )
        .unwrap();
        let registry = ProjectIndexRegistry::default();

        let result =
            retrieve_at_root(&root, "workspace", "context assembly", 8, &registry).unwrap();

        assert_eq!(result.evidence[0].path, "context.rs");
        assert!(result.evidence[0].score > 0);
        assert!(result.index_version.starts_with("local-hybrid-v1-"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uses_content_type_boundaries_without_unbounded_chunks() {
        let prose = (1..=90)
            .map(|line| format!("intro line {line}"))
            .chain(std::iter::once("## Retrieval Design".to_string()))
            .chain((92..=160).map(|line| format!("design line {line}")))
            .collect::<Vec<_>>()
            .join("\n");
        let document = chunk_file("docs/design.md", &prose);
        assert!(document.iter().any(|chunk| {
            chunk.line_start <= 91
                && chunk.line_end >= 91
                && chunk.content.contains("Retrieval Design")
        }));

        let source = (1..=75)
            .map(|line| format!("let value_{line} = {line};"))
            .chain(std::iter::once("fn retrieve_symbol() {}".to_string()))
            .chain((77..=150).map(|line| format!("let tail_{line} = {line};")))
            .collect::<Vec<_>>()
            .join("\n");
        let code = chunk_file("src/retrieval.rs", &source);
        assert!(code.iter().any(|chunk| {
            chunk.line_start <= 76
                && chunk.line_end >= 76
                && chunk.content.contains("retrieve_symbol")
        }));
        assert!(code
            .iter()
            .all(|chunk| chunk.line_end - chunk.line_start < 100));
    }

    #[test]
    fn removes_identical_overlapping_sources_before_budgeting_evidence() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let repeated = std::iter::repeat_n("same_symbol", 220)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(root.join("generated.rs"), repeated).unwrap();
        let registry = ProjectIndexRegistry::default();

        let result = retrieve_at_root(&root, "workspace", "same_symbol", 8, &registry).unwrap();

        let unique: HashSet<_> = result
            .evidence
            .iter()
            .map(|item| format!("{}:{}", item.path, item.content_hash))
            .collect();
        assert_eq!(unique.len(), result.evidence.len());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ranking_is_deterministic_and_prefers_path_matches() {
        let root = test_root();
        fs::create_dir_all(root.join("symbol")).unwrap();
        fs::write(root.join("symbol/one.rs"), "unrelated\nsymbol").unwrap();
        fs::write(root.join("two.rs"), "symbol\nsymbol\nsymbol").unwrap();
        let registry = ProjectIndexRegistry::default();

        let first = retrieve_at_root(&root, "workspace", "symbol", 8, &registry).unwrap();
        let second = retrieve_at_root(&root, "workspace", "symbol", 8, &registry).unwrap();

        assert_eq!(first.evidence[0].path, "symbol/one.rs");
        assert_eq!(first.index_version, second.index_version);
        assert_eq!(
            first.evidence[0].content_hash,
            second.evidence[0].content_hash
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn local_hybrid_quality_baseline_reports_recall_and_mrr() {
        let root = test_root();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(
            root.join("src/context.rs"),
            "assemble context before model invocation\n",
        )
        .unwrap();
        fs::write(
            root.join("src/auth.rs"),
            "validate authentication token claims\n",
        )
        .unwrap();
        fs::write(
            root.join("docs/recovery.md"),
            "restart recovery checkpoint protocol\n",
        )
        .unwrap();
        fs::write(
            root.join("src/unrelated.rs"),
            "shopping list and unrelated prose\n",
        )
        .unwrap();

        let cases = [
            ("context assembly", "src/context.rs"),
            ("authentication token", "src/auth.rs"),
            ("restart recovery", "docs/recovery.md"),
        ];
        let registry = ProjectIndexRegistry::default();
        let started = Instant::now();
        let mut hits = 0usize;
        let mut reciprocal_rank = 0.0f64;
        for (query, expected_path) in cases {
            let result = retrieve_at_root(&root, "baseline", query, 3, &registry).unwrap();
            if let Some((rank, _)) = result
                .evidence
                .iter()
                .enumerate()
                .find(|(_, evidence)| evidence.path == expected_path)
            {
                hits += 1;
                reciprocal_rank += 1.0 / (rank as f64 + 1.0);
            }
        }
        let query_count = 3.0;
        let recall_at_3 = hits as f64 / query_count;
        let mrr = reciprocal_rank / query_count;
        println!(
            "RAG_LOCAL_HYBRID_BASELINE recallAt3={recall_at_3:.4} mrr={mrr:.4} elapsedMs={}",
            started.elapsed().as_millis()
        );
        assert_eq!(recall_at_3, 1.0);
        assert!(mrr >= 0.66);
        fs::remove_dir_all(root).unwrap();
    }
}
