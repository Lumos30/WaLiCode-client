/**
 * HTTP 请求客户端
 * 封装 fetch，统一处理响应格式和错误
 *
 * 默认行为（dev 模式）：baseUrl = ''，走 Vite proxy
 * 生产模式（Tauri）：只连接受 CSP 允许的本机服务端
 */

/** 后端统一响应结构 */
export interface ApiResponse<T = unknown> {
  code: string
  info: string
  data: T | null
}

/** 默认服务端地址 */
const DEFAULT_SERVER_URL = 'http://localhost:8091'
const API_TOKEN_STORAGE_KEY = 'walicode_api_token'
const SERVER_URL_STORAGE_KEY = 'walissh_server_url'
const LOCAL_BACKEND_ORIGINS = new Set([
  'http://localhost:8091',
  'http://127.0.0.1:8091',
])

export function normalizeLocalServerUrl(url: string): string {
  const candidate = url.trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('服务端地址必须是 http://localhost:8091 或 http://127.0.0.1:8091')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
    || !LOCAL_BACKEND_ORIGINS.has(parsed.origin)) {
    throw new Error('当前桌面版只支持本机服务端：http://localhost:8091 或 http://127.0.0.1:8091')
  }
  return parsed.origin
}

// The launcher-provided token is authoritative for local development; saved
// settings are the fallback for production builds and manually configured servers.
let apiToken: string = (import.meta.env.VITE_WALICODE_API_TOKEN || localStorage.getItem(API_TOKEN_STORAGE_KEY) || '').trim()

export function getApiToken(): string {
  return apiToken
}

export function setApiToken(token: string): void {
  apiToken = token.trim()
  if (apiToken) localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken)
  else localStorage.removeItem(API_TOKEN_STORAGE_KEY)
}

export function getAuthHeaders(headers?: HeadersInit, token: string = apiToken): Headers {
  const result = new Headers(headers)
  const trimmed = token.trim()
  if (trimmed) result.set('Authorization', `Bearer ${trimmed}`)
  return result
}

/**
 * 服务端基础地址
 * - dev 模式默认空字符串（走 Vite proxy）
 * - 用户显式设置后覆盖为实际地址（直连）
 * - 生产模式从 localStorage 读取
 */
function storedLocalServerUrl(): string {
  try {
    return normalizeLocalServerUrl(localStorage.getItem(SERVER_URL_STORAGE_KEY) || DEFAULT_SERVER_URL)
  } catch {
    localStorage.removeItem(SERVER_URL_STORAGE_KEY)
    return DEFAULT_SERVER_URL
  }
}

let baseUrl: string = import.meta.env.DEV ? '' : storedLocalServerUrl()

/** 获取当前服务端地址（显示用，空字符串时返回默认值） */
export function getBaseUrl(): string {
  return baseUrl || DEFAULT_SERVER_URL
}

/**
 * 设置服务端地址（持久化到 localStorage）
 *
 * dev 模式下：
 * - 传入空或默认地址 → baseUrl = ''（走 Vite proxy）
 * - 传入其他地址 → baseUrl = 该地址（直连，绕过 proxy）
 *
 * 这样用户在设置页修改的地址才能真正生效
 */
export function setBaseUrl(url: string): string {
  const normalized = normalizeLocalServerUrl(url)
  if (import.meta.env.DEV) {
    baseUrl = normalized === DEFAULT_SERVER_URL ? '' : normalized
  } else {
    baseUrl = normalized
  }
  if (normalized !== DEFAULT_SERVER_URL) {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(SERVER_URL_STORAGE_KEY)
  }
  return normalized
}

/** 请求超时（毫秒） */
const TIMEOUT_MS = 15000

async function readApiResponse<T>(res: globalThis.Response): Promise<ApiResponse<T> | null> {
  try {
    const payload: unknown = await res.json()
    if (payload && typeof payload === 'object'
      && typeof (payload as ApiResponse<T>).code === 'string'
      && typeof (payload as ApiResponse<T>).info === 'string') {
      return payload as ApiResponse<T>
    }
  } catch {
    // Non-JSON failures are normalized below using the HTTP status text.
  }
  return null
}

/**
 * 通用请求方法
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<ApiResponse<T>> {
  // 拼接 query string
  let url = `${baseUrl}${path}`
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    if (qs) url += `?${qs}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const payload = await readApiResponse<T>(res)
    if (payload) return payload
    return { code: String(res.status), info: res.statusText || '请求失败', data: null }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { code: 'TIMEOUT', info: '请求超时', data: null }
    }
    return { code: 'NETWORK_ERROR', info: err?.message || '网络错误', data: null }
  } finally {
    clearTimeout(timer)
  }
}

/** GET 请求 */
export function get<T>(path: string, params?: Record<string, string>) {
  return request<T>('GET', path, undefined, params)
}

/** POST 请求（JSON body + 可选 query params） */
export function post<T>(path: string, body?: unknown, params?: Record<string, string>) {
  return request<T>('POST', path, body, params)
}

/** POST FormData 请求（用于上传文件），无默认超时，支持外部传入 signal 取消 */
export async function postFormData<T>(path: string, formData: FormData, signal?: AbortSignal): Promise<ApiResponse<T>> {
  let url = `${baseUrl}${path}`
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
      signal,
    })

    const payload = await readApiResponse<T>(res)
    if (payload) return payload
    return { code: String(res.status), info: res.statusText || '上传失败', data: null }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { code: 'CANCELLED', info: '上传已取消', data: null }
    }
    return { code: 'NETWORK_ERROR', info: err?.message || '网络错误', data: null }
  }
}

/** PUT 请求 */
export function put<T>(path: string, body?: unknown, params?: Record<string, string>) {
  return request<T>('PUT', path, body, params)
}

/** DELETE 请求 */
export function del<T>(path: string, params?: Record<string, string>) {
  return request<T>('DELETE', path, undefined, params)
}
