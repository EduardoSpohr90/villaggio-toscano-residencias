// Servidor local que reproduz a Vercel: arquivos de dist/ com os mesmos
// cabeçalhos do vercel.json e as funções de api/ no mesmo formato (req, res).
// Uso: npm run build && node scripts/dev-server.mjs [porta]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

// .env.local opcional para desenvolvimento
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function applyHeaders(res, pathname) {
  for (const rule of vercel.headers) {
    const re = new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '.*') + '$');
    if (re.test(pathname)) for (const h of rule.headers) res.setHeader(h.key, h.value);
  }
}

const apiCache = new Map();
async function loadApi(pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z/]+$/.test(rel) || rel.startsWith('_')) return null;
  const file = join(root, 'api', `${rel}.js`);
  if (!existsSync(file)) return null;
  if (!apiCache.has(file)) apiCache.set(file, (await import(pathToFileURL(file).href)).default);
  return apiCache.get(file);
}

export function createDevServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    applyHeaders(res, pathname);
    try {
      if (pathname.startsWith('/api/')) {
        const fn = await loadApi(pathname);
        if (!fn) {
          res.statusCode = 404;
          return res.end('{"error":"Não encontrado."}');
        }
        return await fn(req, res);
      }
      let file = normalize(join(dist, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(dist)) {
        res.statusCode = 400;
        return res.end();
      }
      let s = await stat(file).catch(() => null);
      if (!s || s.isDirectory()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('Não encontrado');
      }
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 4173);
  createDevServer().listen(port, '127.0.0.1', () => console.log(`Nosso Calendário em http://localhost:${port}`));
}
