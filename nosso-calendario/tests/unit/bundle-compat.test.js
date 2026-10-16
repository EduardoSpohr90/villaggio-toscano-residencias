// Regressão do bug do "+ Novo" no iPhone: o bundle publicado não pode usar
// APIs ausentes no Safari/iOS 15 (uma exceção no carregamento deixa botões
// sem ação). Roda sobre dist/ quando o build existe.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'dist', 'assets');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')) : [];

describe.skipIf(!files.length)('compatibilidade do bundle com iOS 15', () => {
  const code = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  it.each([
    ['Array/String .at()', /\.at\(-?\d/],
    ['structuredClone', /structuredClone/],
    ['toSorted / toReversed', /\.(toSorted|toReversed)\(/],
    ['findLast', /\.findLast(Index)?\(/],
    ['Object.hasOwn', /Object\.hasOwn\(/],
    ['<dialog>.showModal', /showModal/],
    ['crypto.randomUUID', /randomUUID/],
  ])('não usa %s', (_name, re) => {
    expect(re.test(code)).toBe(false);
  });
  it('não contém segredos do servidor', () => {
    expect(code).not.toMatch(/client_secret|refresh_token|GOOGLE_CLIENT_SECRET|GOCSPX/);
  });
});
