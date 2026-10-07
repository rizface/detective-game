export class ApiError extends Error {
  status: number
  body: any
  constructor(status: number, message: string, body?: any) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) }
  let body = rest.body
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...rest, headers, body })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: any = undefined
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText, data)
  }
  return data as T
}

export const post = <T = any>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T = any>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json })
export const patch = <T = any>(path: string, json?: unknown) => api<T>(path, { method: 'PATCH', json })
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' })
