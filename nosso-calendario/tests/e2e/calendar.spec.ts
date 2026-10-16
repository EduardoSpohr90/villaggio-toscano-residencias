// Fluxo real no viewport do iPhone, contra um Google falso (OAuth + Calendar).
// Data fixa: quinta, 15/10/2026, 12:00 em São Paulo.
import { test, expect, devices, type Page, type BrowserContext } from '@playwright/test';

const FAKE = 'http://127.0.0.1:4100';
const NOW = new Date('2026-10-15T12:00:00-03:00');
const { defaultBrowserType: _ignored, ...iphone14 } = devices['iPhone 14'];
const IPHONE = { ...iphone14, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', baseURL: 'http://localhost:4174' };

async function dump() {
  const r = await fetch(`${FAKE}/__test/dump`);
  const d = await r.json();
  const cal = Object.values<any>(d.calendars).find((c) => c.summary === 'Família Spohr');
  return { all: d, events: (cal ? cal.events : []) as any[], calendarId: Object.keys(d.calendars).find((k) => d.calendars[k].summary === 'Família Spohr') };
}
const live = async (title: string) => (await dump()).events.filter((e) => e.summary === title && e.status !== 'cancelled');

async function freshPage(context: BrowserContext) {
  await context.clock.setFixedTime(NOW);
  return context.newPage();
}

async function login(page: Page, email = 'eduardo@example.com') {
  await page.goto(`/api/auth/login?hint=${encodeURIComponent(email)}`);
  await page.waitForURL((u) => u.pathname === '/' && !u.search.includes('auth='));
  await expect(page.getByTestId('new-button')).toBeVisible();
}

const sheet = (page: Page) => page.getByTestId('event-sheet');

async function newEvent(page: Page, o: { title: string; owner?: string; category?: string; date?: string; start?: string; end?: string; allDay?: boolean; task?: boolean; repeat?: string }) {
  await page.getByTestId('new-button').tap();
  await expect(sheet(page)).toBeVisible();
  if (o.task) await sheet(page).getByRole('radio', { name: 'Tarefa' }).tap();
  await page.locator('#f-title').fill(o.title);
  if (o.owner) await sheet(page).getByRole('radio', { name: o.owner, exact: true }).tap();
  if (o.category) await sheet(page).locator('.cat-opt', { hasText: o.category }).tap();
  if (o.allDay) await page.locator('#f-allday').check();
  if (o.date) await page.locator('#f-date').fill(o.date);
  if (o.start) await page.locator('#f-start').fill(o.start);
  if (o.end) await page.locator('#f-end').fill(o.end);
  if (o.repeat) await page.locator('#f-repeat').selectOption(o.repeat);
}
async function save(page: Page) {
  await sheet(page).locator('.sheet-head .save').tap();
  await expect(sheet(page)).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fetch(`${FAKE}/__test/reset`);
});

test.describe('fluxo principal no iPhone', () => {
  let context: BrowserContext;
  let page: Page;
  const errors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext(IPHONE);
    page = await freshPage(context);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('1. abre o aplicativo (modo neste aparelho, sem erros)', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Outubro 2026' })).toBeVisible();
    await expect(page.getByTestId('sync-status')).toContainText('Neste aparelho');
  });

  test('2. "+ Novo" abre o formulário com um único toque, em todas as visões', async () => {
    for (const tab of ['Ano', 'Mês', 'Semana', 'Agenda', 'Casal']) {
      await page.locator('.tabbar .tab', { hasText: tab }).tap();
      await page.mouse.wheel(0, 400);
      await page.getByTestId('new-button').tap();
      await expect(sheet(page)).toBeVisible();
      await expect(page.locator('#f-title')).toBeFocused();
      await sheet(page).getByRole('button', { name: 'Cancelar' }).first().tap();
      await expect(sheet(page)).toBeHidden();
    }
    await page.locator('.tabbar .tab', { hasText: 'Mês' }).tap();
  });

  test('conecta ao Google e cria o calendário "Família Spohr"', async () => {
    await page.getByTestId('sync-status').tap();
    await page.getByRole('button', { name: 'Entrar com Google' }).tap();
    await page.waitForURL((u) => u.pathname === '/' && !u.search.includes('auth='));
    await expect(page.getByTestId('toast')).toContainText('Conectado');
    await expect(page.getByTestId('sync-status')).toContainText('Configurar');
    await page.getByTestId('sync-status').tap();
    await page.getByRole('button', { name: /Criar calendário/ }).tap();
    await expect(page.getByTestId('sync-status')).toContainText('Sincronizado');
    await page.getByTestId('account-sheet').getByRole('button', { name: 'OK' }).tap();
    expect((await dump()).calendarId).toBeTruthy();
  });

  test('3–5. cria compromisso e salva no Google Calendar', async () => {
    await newEvent(page, { title: 'Reunião escola', owner: 'Eduardo', category: 'Filhos', date: '2026-10-15', start: '18:30', end: '19:30' });
    await save(page);
    await expect.poll(async () => (await live('Reunião escola')).length).toBe(1);
    const [g] = await live('Reunião escola');
    expect(g.extendedProperties.private).toMatchObject({ nc_owner: 'eduardo', nc_category: 'filhos', nc_kind: 'event' });
    expect(g.start.dateTime).toBe('2026-10-15T18:30:00-03:00');
  });

  test('6. aparece no calendário (mês e lista do dia)', async () => {
    const cell = page.locator('.m-cell[data-date="2026-10-15"]');
    await expect(cell.locator('.m-chip', { hasText: 'Reunião escola' })).toBeVisible();
    await expect(page.getByTestId('day-panel')).toContainText('Reunião escola');
    await expect(page.getByTestId('day-panel')).toContainText('18:30–19:30');
  });

  test('7–8. edita e altera o horário', async () => {
    await page.getByTestId('day-panel').getByRole('button', { name: /Reunião escola/ }).tap();
    await expect(sheet(page)).toBeVisible();
    await page.locator('#f-start').fill('19:00');
    await expect(page.locator('#f-end')).toHaveValue('20:00');
    await save(page);
    await expect.poll(async () => (await live('Reunião escola'))[0]?.start.dateTime).toBe('2026-10-15T19:00:00-03:00');
    await expect(page.getByTestId('day-panel')).toContainText('19:00–20:00');
  });

  test('9. detecta conflito (alerta sem bloquear) e mostra na Semana do casal', async () => {
    await newEvent(page, { title: 'Pilates', owner: 'Esposa', category: 'Saúde', date: '2026-10-15', start: '19:30', end: '20:30' });
    await expect(page.getByTestId('conflict-notice')).toContainText('Reunião escola');
    await save(page);
    await expect.poll(async () => (await live('Pilates')).length).toBe(1);
    await page.locator('.tabbar .tab', { hasText: 'Casal' }).tap();
    const card = page.getByTestId('conflict-card').filter({ hasText: 'Pilates' });
    await expect(card).toContainText('Eduardo — Reunião escola');
    await expect(card).toContainText('Esposa — Pilates');
    await expect(card).toContainText('19:30–20:00');
  });

  test('semana: duração real (09:00–11:30 ocupa 2h30) e agenda pessoal só como "Ocupado"', async () => {
    await newEvent(page, { title: 'Obra Legatto', owner: 'Eduardo', category: 'Trabalho', date: '2026-10-16', start: '09:00', end: '11:30' });
    await save(page);
    await page.locator('.tabbar .tab', { hasText: 'Semana' }).tap();
    const block = page.locator('.w-col[data-date="2026-10-16"] .w-ev', { hasText: 'Obra Legatto' });
    await expect(block).toBeVisible();
    const box = await block.boundingBox();
    expect(Math.round(box!.height)).toBe(150 * 0.8 - 2); // 48px por hora
    const top = await block.evaluate((el) => (el as HTMLElement).style.top);
    expect(top).toBe(`${(9 * 60 - 6 * 60) * 0.8}px`);
    const busy = page.locator('.w-col[data-date="2026-10-14"] .w-ev.busy');
    await expect(busy).toContainText('Ocupado');
    await expect(busy).not.toContainText('reunião', { ignoreCase: true });
    // eventos simultâneos lado a lado
    const a = await page.locator('.w-col[data-date="2026-10-15"] .w-ev', { hasText: 'Reunião' }).boundingBox();
    const b = await page.locator('.w-col[data-date="2026-10-15"] .w-ev', { hasText: 'Pilates' }).boundingBox();
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);
    await expect(page.locator('.w-col[data-date="2026-10-15"] .w-ev.conflict')).toHaveCount(2);
  });

  test('10. tarefa: cria e conclui com um toque', async () => {
    await newEvent(page, { title: 'Pagar escola', task: true, owner: 'Casal', category: 'Casa', allDay: true, date: '2026-10-15' });
    await save(page);
    await page.locator('.tabbar .tab', { hasText: 'Agenda' }).tap();
    await page.getByRole('checkbox', { name: 'Concluir “Pagar escola”' }).tap();
    await expect.poll(async () => (await live('Pagar escola'))[0]?.extendedProperties.private.nc_task).toBe('done');
    await expect(page.getByRole('checkbox', { name: 'Marcar “Pagar escola” como pendente' })).toBeVisible();
  });

  test('filtros combinados: pessoa + categoria', async () => {
    const agenda = page.locator('main');
    await page.locator('.filters .chip', { hasText: 'Eduardo' }).tap();
    await expect(agenda).toContainText('Reunião escola');
    await expect(agenda).not.toContainText('Pilates');
    await page.locator('.filters .chip', { hasText: 'Categorias' }).tap();
    await page.locator('.sheet .cat-opt', { hasText: 'Trabalho' }).tap();
    await page.getByRole('button', { name: 'OK' }).tap();
    await expect(agenda).toContainText('Obra Legatto');
    await expect(agenda).not.toContainText('Reunião escola');
    await page.locator('.filters .chip', { hasText: 'Categorias' }).tap();
    await page.getByRole('button', { name: 'Limpar' }).tap();
    await page.getByRole('button', { name: 'OK' }).tap();
    await page.locator('.filters .chip', { hasText: 'Todos' }).tap();
    await expect(agenda).toContainText('Pilates');
  });

  test('11. exclui', async () => {
    await page.locator('main').getByRole('button', { name: /Pilates/ }).first().tap();
    await sheet(page).getByRole('button', { name: 'Excluir' }).tap();
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Excluir' }).tap();
    await expect.poll(async () => (await live('Pilates')).length).toBe(0);
    await expect(page.locator('main')).not.toContainText('Pilates');
  });

  test('12. recarrega e os dados persistem (vindos do Google)', async () => {
    await page.reload();
    await page.locator('.tabbar .tab', { hasText: 'Agenda' }).tap();
    await expect(page.locator('main')).toContainText('Reunião escola');
    await expect(page.locator('main')).toContainText('Obra Legatto');
    await expect(page.getByTestId('sync-status')).toContainText('Sincronizado');
  });

  test('alteração feita direto no Google aparece no app', async () => {
    const { calendarId } = await dump();
    await fetch(`${FAKE}/__test/external`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calendarId, op: 'insert', event: { id: 'ext0000000001', summary: 'Consulta pediatra', colorId: '4', start: { dateTime: '2026-10-17T10:00:00-03:00' }, end: { dateTime: '2026-10-17T11:00:00-03:00' } } }),
    });
    await page.reload();
    await page.locator('.tabbar .tab', { hasText: 'Agenda' }).tap();
    const row = page.locator('main').getByRole('button', { name: /Consulta pediatra/ });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('aria-label', /Esposa/);
  });

  test('recorrência semanal: editar "somente este evento"', async () => {
    await newEvent(page, { title: 'Inglês', owner: 'Esposa', category: 'Pessoal', date: '2026-10-13', start: '19:00', end: '20:00', repeat: 'weekly' });
    await save(page);
    await expect.poll(async () => (await live('Inglês')).length).toBe(1);
    expect((await live('Inglês'))[0].recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
    await page.reload();
    await page.locator('.tabbar .tab', { hasText: 'Agenda' }).tap();
    const day = page.locator('.day-group[data-date="2026-10-20"]');
    await day.getByRole('button', { name: /Inglês/ }).tap();
    await page.locator('#f-title').fill('Inglês (reposição)');
    await sheet(page).locator('.sheet-head .save').tap();
    await expect(page.getByTestId('scope-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Somente este evento' }).tap();
    await expect(page.locator('.day-group[data-date="2026-10-20"]')).toContainText('Inglês (reposição)');
    await expect(page.locator('.day-group[data-date="2026-10-27"]')).toContainText('Inglês');
    await expect(page.locator('.day-group[data-date="2026-10-27"]')).not.toContainText('reposição');
  });

  test('feriados: somente leitura e discretos (12/10 e 25/08 de Chapecó)', async () => {
    await page.locator('.tabbar .tab', { hasText: 'Mês' }).tap();
    const cell = page.locator('.m-cell[data-date="2026-10-12"]');
    await expect(cell).toHaveClass(/holiday/);
    await expect(cell).toContainText('Nossa Senhora Aparecida');
    await page.locator('.tabbar .tab', { hasText: 'Ano' }).tap();
    await expect(page.getByRole('button', { name: /25 de agosto, Aniversário de Chapecó/ })).toHaveClass(/holiday/);
  });

  test('troca de mês e de ano', async () => {
    await page.getByRole('button', { name: 'Próximo' }).tap();
    await expect(page.getByRole('heading', { name: '2027' })).toBeVisible();
    await page.getByRole('button', { name: 'Anterior' }).tap();
    await page.getByRole('button', { name: /^25 de dezembro/ }).tap();
    await expect(page.getByRole('heading', { name: 'Dezembro 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Próximo' }).tap();
    await expect(page.getByRole('heading', { name: 'Janeiro 2027' })).toBeVisible();
    await page.getByRole('button', { name: 'Hoje' }).tap();
    await expect(page.getByRole('heading', { name: 'Outubro 2026' })).toBeVisible();
  });

  test('sem erros de console durante o fluxo', async () => {
    expect(errors).toEqual([]);
  });
});

test.describe('offline e fila de sincronização', () => {
  test('salva offline e sincroniza ao voltar, sem duplicar', async ({ browser }) => {
    const context = await browser.newContext(IPHONE);
    const page = await freshPage(context);
    await login(page);
    await expect(page.getByTestId('sync-status')).toContainText('Sincronizado');
    await context.setOffline(true);
    await newEvent(page, { title: 'Mercado', owner: 'Casal', category: 'Casa', date: '2026-10-15', start: '17:00', end: '17:30' });
    await save(page);
    await expect(page.getByTestId('toast')).toContainText('será sincronizada quando a conexão voltar');
    await expect(page.getByTestId('sync-status')).toContainText('Offline');
    await expect(page.getByTestId('day-panel')).toContainText('a sincronizar');
    expect(await live('Mercado')).toHaveLength(0);
    await context.setOffline(false);
    await expect.poll(async () => (await live('Mercado')).length, { timeout: 15000 }).toBe(1);
    await expect(page.getByTestId('sync-status')).toContainText('Sincronizado');
    await page.waitForTimeout(500);
    expect(await live('Mercado')).toHaveLength(1);
    await context.close();
  });
});

test.describe('migração de dados antigos do aparelho', () => {
  const legacy = JSON.stringify([
    { titulo: 'Aniversário da vó', data: '20/10/2026', hora: '12:00', responsavel: 'Casal', categoria: 'Família' },
    { titulo: 'Vacina', data: '2026-10-22', responsavel: 'Esposa', categoria: 'Saúde' },
  ]);

  for (const round of [1, 2]) {
    test(`importa sem apagar e sem duplicar (aparelho ${round})`, async ({ browser }) => {
      const context = await browser.newContext(IPHONE);
      await context.addInitScript((data) => {
        if (!localStorage.getItem('agenda_eventos')) localStorage.setItem('agenda_eventos', data);
      }, legacy);
      const page = await freshPage(context);
      await login(page);
      const banner = page.getByTestId('migration-banner');
      await expect(banner).toContainText('Encontramos compromissos salvos neste aparelho');
      await banner.getByRole('button', { name: 'Importar' }).tap();
      await expect.poll(async () => (await live('Aniversário da vó')).length).toBe(1);
      await expect.poll(async () => (await live('Vacina')).length).toBe(1);
      const [g] = await live('Aniversário da vó');
      expect(g.extendedProperties.private).toMatchObject({ nc_owner: 'casal', nc_category: 'familia' });
      expect(await page.evaluate(() => localStorage.getItem('agenda_eventos'))).toBe(legacy);
      await page.reload();
      await expect(page.getByTestId('new-button')).toBeVisible();
      await expect(page.getByTestId('migration-banner')).toBeHidden();
      await context.close();
    });
  }
});

test.describe('robustez do "+ Novo"', () => {
  test('funciona mesmo com localStorage bloqueado (modo privado/cota cheia)', async ({ browser }) => {
    const context = await browser.newContext(IPHONE);
    await context.addInitScript(() => {
      const fail = () => {
        throw new DOMException('Bloqueado', 'QuotaExceededError');
      };
      Storage.prototype.setItem = fail;
      Storage.prototype.getItem = fail;
    });
    const page = await freshPage(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByTestId('new-button').tap();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#f-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    // e ainda permite criar um compromisso (fica em memória nesta sessão)
    await newEvent(page, { title: 'Teste sem armazenamento', date: '2026-10-15', start: '10:00', end: '11:00' });
    await save(page);
    await expect(page.getByTestId('day-panel')).toContainText('Teste sem armazenamento');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('fecha pelo fundo e devolve o foco ao botão', async ({ browser }) => {
    const context = await browser.newContext(IPHONE);
    const page = await freshPage(context);
    await page.goto('/');
    await page.getByTestId('new-button').tap();
    await expect(sheet(page)).toBeVisible();
    await page.mouse.click(195, 8);
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByTestId('new-button')).toBeFocused();
    await context.close();
  });
});

test.describe('PWA', () => {
  test('manifest, ícones e instalabilidade', async ({ page, request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m).toMatchObject({ display: 'standalone', start_url: '/', scope: '/', lang: 'pt-BR' });
    for (const size of ['192x192', '512x512']) expect(m.icons.some((i: any) => i.sizes === size)).toBe(true);
    for (const path of ['/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
      expect((await request.get(path)).headers()['content-type']).toBe('image/png');
    }
    await page.goto('/');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await page.context().newCDPSession(page);
    const res: any = await cdp.send('Page.getInstallabilityErrors' as any);
    expect(res.installabilityErrors).toEqual([]);
  });

  test('abre offline e não guarda a API no cache', async ({ browser }) => {
    const context = await browser.newContext(IPHONE);
    const page = await freshPage(context);
    await login(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    expect(cached).toContain('/index.html');
    expect(cached.some((p) => p.startsWith('/api/'))).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('new-button')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toContainText('Offline');
    await page.locator('.tabbar .tab', { hasText: 'Agenda' }).tap();
    await expect(page.locator('main')).toContainText('Reunião escola');
    await context.close();
  });

  test('nova versão: aviso discreto e atualização com um toque', async ({ browser }) => {
    const context = await browser.newContext(IPHONE);
    const page = await freshPage(context);
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await fetch('http://localhost:4174/__e2e/bump-sw');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    const banner = page.getByTestId('update-banner');
    await expect(banner).toContainText('Nova versão disponível');
    await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: 'Atualizar' }).tap()]);
    await expect(page.getByTestId('update-banner')).toBeHidden();
    await expect(page.getByTestId('new-button')).toBeVisible();
    await context.close();
  });
});

test.describe('segurança', () => {
  test('cabeçalhos e nenhum segredo no JavaScript entregue', async ({ request, page }) => {
    const r = await request.get('/');
    const h = r.headers();
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    await page.goto('/');
    const src = await page.locator('script[type="module"]').getAttribute('src');
    const js = await (await request.get(src!)).text();
    for (const bad of ['test-secret', 'GOOGLE_CLIENT_SECRET', 'client_secret', 'refresh_token', 'GOCSPX']) {
      expect(js).not.toContain(bad);
    }
    const api = await request.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(api.status()).toBe(401);
  });
});
