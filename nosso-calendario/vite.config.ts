import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const BUILD_ID = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

function listPublic(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = `${base}/${name}`;
    return statSync(full).isDirectory() ? listPublic(full, rel) : [rel];
  });
}

/**
 * Gera /sw.js com a lista de precache e uma versão derivada do conteúdo:
 * qualquer mudança em JS, CSS, HTML ou ícones muda a versão, o navegador
 * instala o novo service worker e o app oferece "Atualizar".
 */
function serviceWorker(): Plugin {
  return {
    name: 'nc-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      const files = new Set<string>(['/index.html']);
      for (const [name, out] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue;
        files.add(`/${name}`);
        hash.update(name);
        hash.update(out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : Buffer.from(out.source));
      }
      for (const f of listPublic('public')) {
        if (f === '/robots.txt') continue;
        files.add(f);
        hash.update(f);
        hash.update(readFileSync(join('public', f)));
      }
      files.delete('/index.html');
      const precache = ['/index.html', ...[...files].sort()];
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
      const src = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  plugins: [preact(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${BUILD_ID})`),
  },
  build: {
    // iOS 15+ (iPhone 6s em diante). Evitar APIs mais novas no código.
    target: ['es2020', 'safari15'],
    cssTarget: ['safari15'],
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
