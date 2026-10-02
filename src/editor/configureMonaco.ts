import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js'

// Keep Monaco self-contained for Tauri/offline use. This module is only imported by
// lazy workspaces, so the large editor runtime is not part of the initial screen.
// Only JSON opts into a language service; other file types remain editable without
// bundling the CSS/HTML/TypeScript worker runtimes.
loader.config({ monaco })
