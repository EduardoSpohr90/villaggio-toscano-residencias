// Build de produção do Nosso Calendário via Build Output API da Vercel.
//
// Usado enquanto a Vercel não está conectada ao GitHub: a implantação envia
// só este arquivo e o package.json ao lado. Na máquina de build da Vercel ele
//   1. baixa o código público no commit fixado em NC_SOURCE_COMMIT (e confere o hash);
//   2. instala dependências pelo package-lock, compila e roda os testes;
//   3. monta .vercel/output (estático + funções /api + cabeçalhos do vercel.json).
// Qualquer falha (inclusive de teste) interrompe a publicação.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.NC_SOURCE_REPO || 'https://github.com/EduardoSpohr90/villaggio-toscano-residencias.git';
const COMMIT = String(process.env.NC_SOURCE_COMMIT || '').trim();
const APP_DIR = 'nosso-calendario';
const FUNCTIONS = ['auth/login', 'auth/callback', 'auth/logout', 'me', 'events', 'holidays', 'freebusy', 'setup'];

if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  console.error('NC_SOURCE_COMMIT ausente ou inválido (esperado SHA de 40 caracteres).');
  process.exit(1);
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const out = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

// 1. Código-fonte no commit exato (somente a pasta do app)
const work = join(process.env.NC_WORK_DIR || '/tmp', 'nc-source');
rmSync(work, { recursive: true, force: true });
run('git', ['init', '-q', work]);
run('git', ['remote', 'add', 'origin', REPO], work);
run('git', ['sparse-checkout', 'set', APP_DIR], work);
run('git', ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', COMMIT], work);
run('git', ['checkout', '-q', 'FETCH_HEAD'], work);
const head = out('git', ['rev-parse', 'HEAD'], work);
if (head !== COMMIT) {
  console.error(`Commit baixado (${head}) difere do fixado (${COMMIT}).`);
  process.exit(1);
}
const app = join(work, APP_DIR);
console.log(`Fonte: ${REPO} @ ${COMMIT}`);

// 2. Dependências travadas, build e testes (os testes também conferem o
//    bundle gerado: compatibilidade com iOS 15 e ausência de segredos)
run('npm', ['ci', '--no-audit', '--no-fund'], app);
run('npm', ['run', 'build'], app);
run('npx', ['vitest', 'run'], app);

// 3. Build Output API v3
const output = join(process.cwd(), '.vercel', 'output');
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'static'), { recursive: true });
cpSync(join(app, 'dist'), join(output, 'static'), { recursive: true });

const esbuild = await import(pathToFileURL(join(app, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
for (const fn of FUNCTIONS) {
  const entry = join(app, 'api', `${fn}.js`);
  if (!existsSync(entry)) throw new Error(`Função ausente: ${entry}`);
  const dir = join(output, 'functions', 'api', `${fn}.func`);
  mkdirSync(dir, { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(dir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  });
  writeFileSync(
    join(dir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: true }),
  );
}

// Cabeçalhos: os mesmos do vercel.json, convertidos em rotas.
const vercel = JSON.parse(readFileSync(join(app, 'vercel.json'), 'utf8'));
const routes = vercel.headers.map((rule) => ({
  src: `^${rule.source.replace(/\(\.\*\)/g, '(.*)')}$`,
  headers: Object.fromEntries(rule.headers.map((h) => [h.key, h.value])),
  continue: true,
}));
routes.push({ handle: 'filesystem' });
writeFileSync(join(output, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));
console.log(`Build Output pronto: ${FUNCTIONS.length} funções, estático de dist/.`);
