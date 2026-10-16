// Integração: funções da API (as mesmas da Vercel) contra o Google falso.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createFakeGoogle } from '../support/fake-google.mjs';

let fake, server, base, fakeBase;
const EDU = 'eduardo@example.com';
const ESP = 'esposa@example.com';

function jar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    store(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const k = pair.slice(0, i);
        const v = pair.slice(i + 1);
        if (/Max-Age=0/.test(c)) cookies.delete(k);
        else cookies.set(k, v);
      }
    },
    raw: cookies,
  };
}

async function login(email) {
  const j = jar();
  let r = await fetch(`${base}/api/auth/login?hint=${encodeURIComponent(email)}`, { redirect: 'manual' });
  expect(r.status).toBe(302);
  j.store(r);
  const toGoogle = r.headers.get('location');
  expect(toGoogle.startsWith(fakeBase)).toBe(true);
  const u = new URL(toGoogle);
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('access_type')).toBe('offline');
  r = await fetch(toGoogle, { redirect: 'manual' });
  const callback = r.headers.get('location');
  r = await fetch(callback, { redirect: 'manual', headers: { cookie: j.header() } });
  j.store(r);
  return { jar: j, location: r.headers.get('location') };
}

function api(j) {
  const call = async (method, path, body, extra = {}) => {
    const headers = { cookie: j.header(), ...extra };
    if (method !== 'GET') headers['x-nc-csrf'] = '1';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    j.store(r);
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b, h) => call('POST', p, b, h),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
  };
}

const ev = (over = {}) => ({
  title: 'Reunião escola', owner: 'casal', category: 'filhos', kind: 'event', allDay: false,
  start: '2026-10-20T18:30', end: '2026-10-20T19:30', location: '', notes: '', reminder: '10', ...over,
});

beforeAll(async () => {
  fake = createFakeGoogle({ clientId: 'test-client' });
  const fp = await fake.listen();
  fakeBase = `http://127.0.0.1:${fp}`;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ALLOWED_USERS: `eduardo:${EDU},esposa:${ESP}`,
    FAMILY_CALENDAR_NAME: 'Família Spohr',
    GOOGLE_OAUTH_AUTHORIZE_URL: `${fakeBase}/o/oauth2/v2/auth`,
    GOOGLE_OAUTH_TOKEN_URL: `${fakeBase}/token`,
    GOOGLE_CALENDAR_API_BASE: `${fakeBase}/calendar/v3`,
    BUSY_SOURCES: 'eduardo:trabalho@example.com,esposa:private-esposa@example.com',
  });
  const { createDevServer } = await import('../../scripts/dev-server.mjs');
  server = createDevServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fake.close();
});

describe('autenticação', () => {
  it('sem sessão: não autenticado, sem dados', async () => {
    const r = await api(jar()).get('/api/me');
    expect(r.body).toMatchObject({ configured: true, authenticated: false });
    expect((await api(jar()).get('/api/events?from=2026-10-01&to=2026-11-01')).status).toBe(401);
  });
  it('conta fora da lista é recusada', async () => {
    const { location } = await login('intruso@example.com');
    expect(location).toBe('/?auth=not_allowed');
  });
  it('state adulterado é recusado', async () => {
    const j = jar();
    let r = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
    j.store(r);
    r = await fetch(`${base}/api/auth/callback?code=code-${EDU}&state=forjado`, { redirect: 'manual', headers: { cookie: j.header() } });
    expect(r.headers.get('location')).toBe('/?auth=state');
  });
  it('login completo com PKCE; cookie HttpOnly cifrado, sem tokens legíveis', async () => {
    const { jar: j, location } = await login(EDU);
    expect(location).toBe('/?auth=ok');
    const value = [...j.raw.values()].join(' ');
    expect(value).not.toMatch(/rt-|at-|eduardo/);
    const me = await api(j).get('/api/me');
    expect(me.body).toMatchObject({ authenticated: true, email: EDU, person: 'eduardo', calendar: null });
  });
});

describe('calendário da família e CRUD', () => {
  let edu, esp;
  beforeAll(async () => {
    edu = api((await login(EDU)).jar);
  });

  it('sem calendário: pede configuração', async () => {
    const r = await edu.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('no_calendar');
  });
  it('cria "Família Spohr" e compartilha com a esposa', async () => {
    const r = await edu.post('/api/setup', {});
    expect(r.body).toMatchObject({ summary: 'Família Spohr', created: true, shared: [ESP] });
    const again = await edu.post('/api/setup', {});
    expect(again.body.created).toBe(false);
  });
  it('CSRF: sem cabeçalho próprio ou de outra origem é recusado', async () => {
    const r1 = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r1.status).toBe(403);
    const r2 = await edu.post('/api/events', { event: ev() }, { origin: 'https://evil.example' });
    expect(r2.status).toBe(403);
  });
  it('valida responsável e datas no servidor', async () => {
    expect((await edu.post('/api/events', { event: ev({ owner: 'root' }) })).status).toBe(400);
    expect((await edu.post('/api/events', { event: ev({ end: '2026-10-20T10:00' }) })).status).toBe(400);
  });
  it('cria de forma idempotente (mesmo id não duplica)', async () => {
    const r = await edu.post('/api/events', { id: 'nc0000000000001', event: ev() });
    expect(r.status).toBe(201);
    expect(r.body.event).toMatchObject({ id: 'nc0000000000001', owner: 'casal', category: 'filhos', reminder: '10' });
    const again = await edu.post('/api/events', { id: 'nc0000000000001', event: ev() });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const list = await edu.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(list.body.events.filter((e) => e.id === 'nc0000000000001')).toHaveLength(1);
  });
  it('metadados no Google ficam em extendedProperties.private e createdBy vem da sessão', async () => {
    const dump = await (await fetch(`${fakeBase}/__test/dump`)).json();
    const cal = Object.values(dump.calendars).find((c) => c.summary === 'Família Spohr');
    const g = cal.events.find((e) => e.id === 'nc0000000000001');
    expect(g.summary).toBe('Reunião escola');
    expect(g.extendedProperties.private).toMatchObject({ nc_owner: 'casal', nc_by: EDU, nc_source: 'nosso-calendario' });
  });
  it('edita horário', async () => {
    const r = await edu.patch('/api/events?id=nc0000000000001&scope=this', { event: ev({ start: '2026-10-20T19:00', end: '2026-10-20T20:30' }) });
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ start: '2026-10-20T19:00', end: '2026-10-20T20:30' });
  });
  it('a esposa entra e vê o mesmo calendário', async () => {
    esp = api((await login(ESP)).jar);
    const me = await esp.get('/api/me');
    expect(me.body).toMatchObject({ person: 'esposa', calendar: { summary: 'Família Spohr' } });
    const list = await esp.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(list.body.events.map((e) => e.title)).toContain('Reunião escola');
  });
  it('alteração feita direto no Google aparece no app (bidirecional)', async () => {
    const dump = await (await fetch(`${fakeBase}/__test/dump`)).json();
    const calendarId = Object.keys(dump.calendars).find((k) => dump.calendars[k].summary === 'Família Spohr');
    await fetch(`${fakeBase}/__test/external`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calendarId, op: 'insert', event: { id: 'ext000001', summary: 'Pediatra', colorId: '4', start: { dateTime: '2026-10-21T08:00:00-03:00' }, end: { dateTime: '2026-10-21T09:00:00-03:00' } } }),
    });
    await fetch(`${fakeBase}/__test/external`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calendarId, op: 'patch', id: 'nc0000000000001', event: { summary: 'Reunião escola (sala 3)' } }),
    });
    const list = await edu.get('/api/events?from=2026-10-01&to=2026-11-01');
    const titles = list.body.events.map((e) => e.title);
    expect(titles).toContain('Reunião escola (sala 3)');
    expect(list.body.events.find((e) => e.id === 'ext000001')).toMatchObject({ owner: 'esposa', category: 'familia' });
  });
  it('exclui (e excluir de novo não falha)', async () => {
    expect((await edu.del('/api/events?id=ext000001&scope=this')).status).toBe(200);
    expect((await edu.del('/api/events?id=ext000001&scope=this')).status).toBe(200);
    const list = await edu.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(list.body.events.map((e) => e.id)).not.toContain('ext000001');
  });
});

describe('recorrências', () => {
  let edu;
  const range = '/api/events?from=2026-10-01&to=2026-12-01';
  beforeAll(async () => {
    edu = api((await login(EDU)).jar);
  });
  const series = () => edu.get(range).then((r) => r.body.events.filter((e) => e.seriesId === 'rec000000001' || e.title.startsWith('Inglês')));

  it('cria série semanal e lista instâncias com a regra', async () => {
    const r = await edu.post('/api/events', {
      id: 'rec000000001',
      event: ev({ title: 'Inglês', owner: 'esposa', category: 'pessoal', start: '2026-10-05T19:00', end: '2026-10-05T20:00', rrule: 'FREQ=WEEKLY;COUNT=6' }),
    });
    expect(r.status).toBe(201);
    const s = await series();
    expect(s.map((e) => e.start)).toEqual([
      '2026-10-05T19:00', '2026-10-12T19:00', '2026-10-19T19:00', '2026-10-26T19:00', '2026-11-02T19:00', '2026-11-09T19:00',
    ]);
    expect(s[0]).toMatchObject({ seriesId: 'rec000000001', rrule: 'FREQ=WEEKLY;COUNT=6' });
  });
  it('somente este evento', async () => {
    const s = await series();
    const third = s[2];
    const r = await edu.patch(`/api/events?id=${third.id}&scope=this`, { event: { ...third, start: '2026-10-19T20:00', end: '2026-10-19T21:00' } });
    expect(r.status).toBe(200);
    const after = await series();
    expect(after.map((e) => e.start)).toContain('2026-10-19T20:00');
    expect(after).toHaveLength(6);
  });
  it('este e os próximos (divide a série, mantém o total)', async () => {
    const s = await series();
    const fourth = s.find((e) => e.start === '2026-10-26T19:00');
    const r = await edu.patch(`/api/events?id=${fourth.id}&scope=following`, {
      event: { ...fourth, title: 'Inglês avançado', start: '2026-10-26T18:00', end: '2026-10-26T19:00' },
      newId: 'rec000000002',
    });
    expect(r.status).toBe(200);
    const after = await series();
    expect(after.map((e) => `${e.title}@${e.start}`)).toEqual([
      'Inglês@2026-10-05T19:00', 'Inglês@2026-10-12T19:00', 'Inglês@2026-10-19T20:00',
      'Inglês avançado@2026-10-26T18:00', 'Inglês avançado@2026-11-02T18:00', 'Inglês avançado@2026-11-09T18:00',
    ]);
  });
  it('excluir somente uma ocorrência e depois toda a série', async () => {
    let s = await series();
    const target = s.find((e) => e.start === '2026-11-02T18:00');
    expect((await edu.del(`/api/events?id=${target.id}&scope=this`)).status).toBe(200);
    s = await series();
    expect(s.map((e) => e.start)).not.toContain('2026-11-02T18:00');
    const any = s.find((e) => e.seriesId === 'rec000000002');
    expect((await edu.del(`/api/events?id=${any.id}&scope=all`)).status).toBe(200);
    s = await series();
    expect(s.every((e) => e.title === 'Inglês')).toBe(true);
  });
  it('toda a série: muda horário de todas as ocorrências', async () => {
    const s = await series();
    const r = await edu.patch(`/api/events?id=${s[1].id}&scope=all`, { event: { ...s[1], start: '2026-10-12T07:00', end: '2026-10-12T08:00' } });
    expect(r.status).toBe(200);
    const after = await series();
    expect(after.filter((e) => e.start.endsWith('07:00')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('feriados, disponibilidade e sessão', () => {
  let edu, j;
  beforeAll(async () => {
    j = (await login(EDU)).jar;
    edu = api(j);
  });
  it('feriados do calendário "Feriados no Brasil"', async () => {
    const r = await edu.get('/api/holidays?year=2026');
    expect(r.body.holidays.find((h) => h.date === '2026-10-12')).toMatchObject({ name: 'Nossa Senhora Aparecida', kind: 'feriado' });
    expect(r.body.holidays.find((h) => h.date === '2026-10-15').kind).toBe('comemorativa');
  });
  it('agendas individuais aparecem só como Ocupado', async () => {
    const r = await edu.get('/api/freebusy?from=2026-10-12&to=2026-10-19');
    expect(r.body.enabled).toBe(true);
    expect(r.body.blocks[0]).toEqual({ id: expect.any(String), owner: 'eduardo', start: '2026-10-14T09:00', end: '2026-10-14T10:00' });
    expect(Object.keys(r.body.blocks[0])).not.toContain('title');
    expect(r.body.unavailable).toEqual(['esposa']);
  });
  it('token expirado no Google é renovado de forma transparente', async () => {
    await fetch(`${fakeBase}/__test/expire`);
    const before = fake.state.refreshCount;
    const r = await edu.get('/api/events?from=2026-10-01&to=2026-11-01');
    expect(r.status).toBe(200);
    expect(fake.state.refreshCount).toBe(before + 1);
  });
  it('logout limpa a sessão', async () => {
    expect((await edu.post('/api/auth/logout', {})).status).toBe(200);
    expect((await edu.get('/api/me')).body.authenticated).toBe(false);
  });
});
