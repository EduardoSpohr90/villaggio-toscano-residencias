// @ts-check
// Utilitários HTTP portáveis (Node puro): rodam igual na Vercel e no
// servidor local de desenvolvimento/testes.

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code código estável para o cliente
   * @param {string} message mensagem humana, segura para exibir
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {import('http').IncomingMessage} req */
export function requestUrl(req) {
  return new URL(req.url || '/', 'http://localhost');
}

/** Origem pública da requisição (atrás do proxy da Vercel). */
export function requestOrigin(req, cfg) {
  if (cfg && cfg.appUrl) return cfg.appUrl;
  const h = req.headers;
  const proto = String(h['x-forwarded-proto'] || '').split(',')[0] || 'http';
  const host = String(h['x-forwarded-host'] || h.host || 'localhost').split(',')[0];
  return `${proto}://${host}`;
}

export function isSecure(req, cfg) {
  return requestOrigin(req, cfg).startsWith('https://');
}

/** @param {import('http').IncomingMessage} req */
export function parseCookies(req) {
  /** @type {Record<string, string>} */
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* cookie malformado é ignorado */
    }
  }
  return out;
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge?: number, secure: boolean, sameSite?: 'Lax'|'Strict' }} opts
 */
export function setCookie(res, name, value, opts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${opts.sameSite || 'Lax'}`];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

/** @param {import('http').ServerResponse} res */
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** @param {import('http').ServerResponse} res */
export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/**
 * Corpo JSON com limite de tamanho. Usa req.body quando a Vercel já leu.
 * @param {any} req
 */
export async function readJson(req, limit = 64 * 1024) {
  let pre;
  try {
    pre = req.body;
  } catch {
    throw new HttpError(400, 'bad_json', 'Dados inválidos.');
  }
  if (pre !== undefined && pre !== null && pre !== '') {
    if (typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre;
    try {
      return JSON.parse(Buffer.isBuffer(pre) ? pre.toString('utf8') : String(pre));
    } catch {
      throw new HttpError(400, 'bad_json', 'Dados inválidos.');
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Conteúdo grande demais.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json', 'Dados inválidos.');
  }
}

/**
 * Proteção CSRF para métodos que alteram dados:
 * - cookie de sessão SameSite=Lax (não vai em POST de outro site);
 * - cabeçalho próprio obrigatório (força preflight CORS, que não é aceito);
 * - Origin, quando presente, precisa ser a própria aplicação.
 */
export function assertMutationAllowed(req, cfg) {
  if (req.headers['x-nc-csrf'] !== '1') throw new HttpError(403, 'csrf', 'Requisição recusada.');
  const origin = req.headers.origin;
  if (origin && origin !== requestOrigin(req, cfg)) throw new HttpError(403, 'csrf', 'Requisição recusada.');
  const ct = String(req.headers['content-type'] || '');
  if (req.method !== 'DELETE' && !ct.includes('application/json')) {
    throw new HttpError(415, 'content_type', 'Requisição recusada.');
  }
}

/**
 * Envolve um handler: erros conhecidos viram JSON com mensagem humana;
 * detalhes técnicos ficam só no log do servidor.
 * @param {(req: any, res: any) => Promise<void>} fn
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const e = /** @type {any} */ (err);
      if (e instanceof HttpError) {
        if (e.status >= 500) console.error('[api]', e.code, e.message);
        sendJson(res, e.status, { error: e.message, code: e.code });
        return;
      }
      console.error('[api] erro inesperado', e && e.stack ? e.stack : e);
      sendJson(res, 500, { error: 'Não foi possível concluir agora.', code: 'internal' });
    }
  };
}

export function methodNotAllowed() {
  return new HttpError(405, 'method', 'Operação não permitida.');
}
