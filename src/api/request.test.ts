import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('local backend URL policy', () => {
  it('accepts exactly the CSP-supported loopback origins', async () => {
    const { normalizeLocalServerUrl } = await import('./request')

    expect(normalizeLocalServerUrl('http://localhost:8091/')).toBe('http://localhost:8091')
    expect(normalizeLocalServerUrl('http://127.0.0.1:8091')).toBe('http://127.0.0.1:8091')
  })

  it('rejects remote, credentialed, and path-bearing server addresses', async () => {
    const { normalizeLocalServerUrl } = await import('./request')

    expect(() => normalizeLocalServerUrl('https://43.140.222.51:8091')).toThrow('只支持本机服务端')
    expect(() => normalizeLocalServerUrl('http://user:pass@localhost:8091')).toThrow('只支持本机服务端')
    expect(() => normalizeLocalServerUrl('http://localhost:8091/api')).toThrow('只支持本机服务端')
  })
})
