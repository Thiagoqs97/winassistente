// Wrapper de fetch que sempre envia o cookie (credentials: 'include').
// Lança erro se response não for OK; devolve JSON.

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, { ...init, credentials: 'include', headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (body && body.error) || (typeof body === 'string' ? body : `HTTP ${res.status}`);
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}
