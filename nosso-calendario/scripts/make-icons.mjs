// Gera os PNGs da PWA a partir de public/icons/icon.svg usando o Chromium.
// npm run icons
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const executablePath = process.env.PW_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();

async function render(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable
    ? svg.replace('<rect width="512" height="512" fill="#f6f5f2"/>', '<rect width="512" height="512" fill="#f6f5f2"/><g transform="translate(256 256) scale(0.8) translate(-256 -256)">').replace('</svg>', '</g></svg>')
    : svg;
  await page.setContent(`<html><body style="margin:0">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: false }));
  console.log('ok', file);
}

await render(180, 'public/icons/apple-touch-icon.png');
await render(192, 'public/icons/icon-192.png');
await render(512, 'public/icons/icon-512.png');
await render(512, 'public/icons/icon-maskable-512.png', { maskable: true });
await browser.close();
