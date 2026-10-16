// Cliente da API própria (/api/*). Credenciais nunca passam por aqui: a
// sessão é um cookie HttpOnly que o navegador envia sozinho.

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** Sem conexão ou servidor inalcançável: vale tentar de novo depois. */
  get retriable() {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

const TIMEOUT = 20000;

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : 0;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-NC-CSRF'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Você está offline.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && typeof data.error === 'string' && data.error) || 'Não foi possível sincronizar.';
    throw new ApiError(res.status, (data && data.code) || 'error', msg);
  }
  return data as T;
}
