// Google falso para testes de integração e E2E: OAuth (authorize/token) e o
// subconjunto da Calendar API v3 usado pelo app. Nunca roda em produção.
//
// Comportamentos reproduzidos do Google real que importam para o app:
// - ID de evento fornecido pelo cliente; repetição devolve 409
// - singleEvents=true expande séries; IDs de instância <id>_<UTC>
// - PATCH/DELETE em instância cria exceção na série
// - lista sem expansão devolve a série com `recurrence`
// - extendedProperties.private, colorId, reminders preservados

import http from 'node:http';
import { expandOccurrences, instanceId } from '../../shared/recurrence.js';
import { wallToMs, isoToWall, tzOffsetMs, addDays } from '../../shared/dates.js';

const HOLIDAY_CAL = 'pt.brazilian#holiday@group.v.calendar.google.com';

function wallToIso(wall) {
  const ms = wallToMs(wall);
  const off = tzOffsetMs(ms) / 60000;
  const sign = off <= 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${wall}:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
// dateTime sem offset + timeZone de SP (como o app envia) já é hora de parede.
const toWall = (t) => (t.date ? t.date : t.dateTime.length === 19 ? t.dateTime.slice(0, 16) : isoToWall(t.dateTime));
const fromWall = (w, allDay) => (allDay ? { date: w } : { dateTime: wallToIso(w), timeZone: 'America/Sao_Paulo' });

export function createFakeGoogle({ clientId = 'test-client', defaultEmail = 'eduardo@example.com' } = {}) {
  const state = {
    calendars: new Map(),
    lists: new Map(), // email -> Set(calId)
    tokens: new Map(), // access token -> email
    refreshCount: 0,
    requests: [],
  };
  const reset = () => {
    state.calendars.clear();
    state.lists.clear();
    state.tokens.clear();
    state.requests.length = 0;
    state.calendars.set(HOLIDAY_CAL, { id: HOLIDAY_CAL, summary: 'Feriados no Brasil', events: new Map(), ex: new Map() });
    const hol = state.calendars.get(HOLIDAY_CAL);
    for (const [date, name, description] of [
      ['2026-10-12', 'Nossa Senhora Aparecida', 'Feriado nacional'],
      ['2026-11-02', 'Dia de Finados', 'Feriado nacional'],
      ['2026-11-15', 'Proclamação da República', 'Feriado nacional'],
      ['2026-10-15', 'Dia do Professor', 'Observância'],
    ]) {
      hol.events.set(`h${date.replace(/-/g, '')}`, store({
        id: `h${date.replace(/-/g, '')}`, summary: name, description,
        start: { date }, end: { date: addDays(date, 1) }, status: 'confirmed',
      }));
    }
  };
  reset();

  const listFor = (email) => {
    if (!state.lists.has(email)) state.lists.set(email, new Set());
    return state.lists.get(email);
  };

  function materialize(cal, ev) {
    // Converte evento armazenado (com wall times) para a forma da API.
    return {
      kind: 'calendar#event',
      ...ev,
      start: fromWall(ev._start, ev._allDay),
      end: fromWall(ev._end, ev._allDay),
      _start: undefined, _end: undefined, _allDay: undefined,
    };
  }
  function clean(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function store(ev) {
    const allDay = !!ev.start.date;
    return { ...ev, _allDay: allDay, _start: toWall(ev.start), _end: toWall(ev.end), start: undefined, end: undefined };
  }

  function instancesOf(cal, master, fromMs, toMs) {
    const rule = (master.recurrence || []).find((r) => r.startsWith('RRULE:'));
    const ex = cal.ex.get(master.id) || { exdates: new Set(), overrides: new Map() };
    const fromDate = isoToWall(new Date(fromMs).toISOString()).slice(0, 10);
    const toDate = addDays(isoToWall(new Date(toMs).toISOString()).slice(0, 10), 1);
    const occ = expandOccurrences(
      { start: master._start, end: master._end, allDay: master._allDay, rrule: rule ? rule.slice(6) : undefined },
      fromDate, toDate,
    );
    const out = [];
    for (const o of occ) {
      const iid = instanceId(master.id, o.originalStart, master._allDay);
      if (ex.exdates.has(o.originalStart)) continue;
      const override = ex.overrides.get(o.originalStart);
      const base = override || {
        ...master, recurrence: undefined, _start: o.start, _end: o.end,
      };
      out.push({
        ...base,
        id: iid,
        recurringEventId: master.id,
        originalStartTime: fromWall(o.originalStart, master._allDay),
      });
    }
    return out.filter((e) => {
      const s = wallToMs(e._allDay ? `${e._start}T00:00` : e._start);
      const en = wallToMs(e._allDay ? `${e._end}T00:00` : e._end);
      return s < toMs && en > fromMs;
    });
  }

  function findInstance(cal, id) {
    const m = /^(.+)_(\d{8})(T\d{6}Z)?$/.exec(id);
    if (!m) return null;
    const master = cal.events.get(m[1]);
    if (!master || master.status === 'cancelled') return null;
    const all = instancesOf(cal, master, wallToMs('1990-01-01T00:00'), wallToMs('2100-01-01T00:00'));
    return all.find((x) => x.id === id) || null;
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  function gErr(res, status, reason) {
    send(res, status, { error: { code: status, errors: [{ reason }], message: reason } });
  }
  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
    return raw ? JSON.parse(raw) : {};
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (email) =>
    `${b64({ alg: 'none' })}.${b64({ iss: 'https://accounts.google.com', aud: clientId, email, email_verified: true, name: email.split('@')[0], exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;

  let tokenSeq = 0;
  function issue(email) {
    const at = `at-${++tokenSeq}-${email}`;
    state.tokens.set(at, email);
    return at;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const p = url.pathname;
    state.requests.push(`${req.method} ${p}`);
    try {
      // ---------- controle de teste ----------
      if (p === '/__test/reset') { reset(); return send(res, 200, { ok: true }); }
      if (p === '/__test/dump') {
        const cals = {};
        for (const [id, c] of state.calendars) cals[id] = { summary: c.summary, events: [...c.events.values()].map(clean) };
        return send(res, 200, { calendars: cals, lists: Object.fromEntries([...state.lists].map(([k, v]) => [k, [...v]])) });
      }
      if (p === '/__test/expire') { state.tokens.clear(); return send(res, 200, { ok: true }); }
      if (p === '/__test/external' && req.method === 'POST') {
        // Simula alguém editando direto no Google Calendar.
        const { calendarId, op, event, id } = await readBody(req);
        const cal = state.calendars.get(calendarId);
        if (op === 'insert') cal.events.set(event.id, store({ status: 'confirmed', ...event, updated: new Date().toISOString() }));
        if (op === 'patch') {
          const cur = cal.events.get(id);
          const merged = { ...materialize(cal, cur), ...event };
          cal.events.set(id, store({ ...merged, updated: new Date().toISOString() }));
        }
        if (op === 'delete') cal.events.get(id).status = 'cancelled';
        return send(res, 200, { ok: true });
      }

      // ---------- OAuth ----------
      if (p === '/o/oauth2/v2/auth') {
        const redirect = new URL(url.searchParams.get('redirect_uri'));
        const email = url.searchParams.get('login_hint') || defaultEmail;
        redirect.searchParams.set('code', `code-${email}`);
        redirect.searchParams.set('state', url.searchParams.get('state'));
        res.writeHead(302, { Location: redirect.toString() });
        return res.end();
      }
      if (p === '/token' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.client_id !== clientId || body.client_secret !== 'test-secret') return send(res, 401, { error: 'invalid_client' });
        if (body.grant_type === 'authorization_code') {
          if (!body.code_verifier) return send(res, 400, { error: 'invalid_request' });
          const email = String(body.code).replace(/^code-/, '');
          return send(res, 200, { access_token: issue(email), expires_in: 3600, refresh_token: `rt-${email}`, id_token: idToken(email), token_type: 'Bearer' });
        }
        if (body.grant_type === 'refresh_token') {
          state.refreshCount++;
          const email = String(body.refresh_token).replace(/^rt-/, '');
          if (email === 'revoked@example.com') return send(res, 400, { error: 'invalid_grant' });
          return send(res, 200, { access_token: issue(email), expires_in: 3600, token_type: 'Bearer' });
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }

      // ---------- Calendar API ----------
      if (!p.startsWith('/calendar/v3/')) return gErr(res, 404, 'notFound');
      const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const email = state.tokens.get(auth);
      if (!email) return gErr(res, 401, 'authError');
      const rest = p.slice('/calendar/v3'.length);

      if (rest === '/users/me/calendarList' && req.method === 'GET') {
        const items = [...listFor(email)].map((id) => {
          const c = state.calendars.get(id);
          return { id, summary: c.summary, accessRole: c.owner === email ? 'owner' : 'writer' };
        });
        return send(res, 200, { items });
      }
      if (rest === '/calendars' && req.method === 'POST') {
        const body = await readBody(req);
        const id = `cal${state.calendars.size}${Date.now()}@group.calendar.google.com`;
        state.calendars.set(id, { id, summary: body.summary, owner: email, events: new Map(), ex: new Map(), acl: [email] });
        listFor(email).add(id);
        return send(res, 200, { id, summary: body.summary, timeZone: body.timeZone });
      }
      if (rest === '/freeBusy' && req.method === 'POST') {
        const body = await readBody(req);
        const calendars = {};
        for (const it of body.items) {
          if (it.id.startsWith('private')) calendars[it.id] = { errors: [{ reason: 'notFound' }], busy: [] };
          else calendars[it.id] = { busy: [{ start: '2026-10-14T12:00:00Z', end: '2026-10-14T13:00:00Z' }] };
        }
        return send(res, 200, { calendars });
      }
      let m = /^\/calendars\/([^/]+)\/acl$/.exec(rest);
      if (m && req.method === 'POST') {
        const cal = state.calendars.get(decodeURIComponent(m[1]));
        const body = await readBody(req);
        cal.acl.push(body.scope.value);
        listFor(body.scope.value).add(cal.id); // simula o aceite do convite
        return send(res, 200, { id: `user:${body.scope.value}`, role: body.role });
      }
      m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(rest);
      if (!m) return gErr(res, 404, 'notFound');
      const calId = decodeURIComponent(m[1]);
      const cal = state.calendars.get(calId);
      if (!cal) return gErr(res, 404, 'notFound');
      if (calId !== HOLIDAY_CAL && !cal.acl.includes(email)) return gErr(res, 403, 'forbidden');
      const evId = m[2] ? decodeURIComponent(m[2]) : null;

      if (!evId && req.method === 'GET') {
        const single = url.searchParams.get('singleEvents') === 'true';
        const fromMs = Date.parse(url.searchParams.get('timeMin'));
        const toMs = Date.parse(url.searchParams.get('timeMax'));
        const items = [];
        for (const ev of cal.events.values()) {
          if (ev.status === 'cancelled') continue;
          if (ev.recurrence && ev.recurrence.length) {
            if (single) items.push(...instancesOf(cal, ev, fromMs, toMs));
            else if (instancesOf(cal, ev, fromMs, toMs).length) items.push(ev);
          } else {
            const s = wallToMs(ev._allDay ? `${ev._start}T00:00` : ev._start);
            const e = wallToMs(ev._allDay ? `${ev._end}T00:00` : ev._end);
            if (s < toMs && e > fromMs) items.push(ev);
          }
        }
        items.sort((a, b) => (a._start < b._start ? -1 : 1));
        return send(res, 200, { items: items.map((e) => clean(materialize(cal, e))) });
      }
      if (!evId && req.method === 'POST') {
        const body = await readBody(req);
        const id = body.id || `srv${Date.now()}`;
        if (cal.events.has(id)) return gErr(res, 409, 'duplicate');
        const ev = store({ ...body, id, status: 'confirmed', creator: { email }, updated: new Date().toISOString() });
        if (ev.recurrence && !ev.recurrence.length) delete ev.recurrence;
        cal.events.set(id, ev);
        return send(res, 200, clean(materialize(cal, ev)));
      }
      // Evento ou instância
      const direct = cal.events.get(evId);
      const inst = direct ? null : findInstance(cal, evId);
      if (req.method === 'GET') {
        if (direct) return send(res, 200, clean(materialize(cal, direct)));
        if (inst) return send(res, 200, clean(materialize(cal, inst)));
        return gErr(res, 404, 'notFound');
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        if (direct) {
          const merged = { ...materialize(cal, direct), ...body, updated: new Date().toISOString() };
          const ev = store(merged);
          if (ev.recurrence && !ev.recurrence.length) delete ev.recurrence;
          cal.events.set(evId, ev);
          return send(res, 200, clean(materialize(cal, ev)));
        }
        if (inst) {
          if (body.recurrence) return gErr(res, 400, 'invalid');
          const ex = cal.ex.get(inst.recurringEventId) || { exdates: new Set(), overrides: new Map() };
          cal.ex.set(inst.recurringEventId, ex);
          const orig = toWall(inst.originalStartTime);
          const merged = store({ ...materialize(cal, inst), ...body, updated: new Date().toISOString() });
          ex.overrides.set(orig, merged);
          return send(res, 200, clean(materialize(cal, { ...merged, id: evId })));
        }
        return gErr(res, 404, 'notFound');
      }
      if (req.method === 'DELETE') {
        if (direct) {
          if (direct.status === 'cancelled') return gErr(res, 410, 'deleted');
          direct.status = 'cancelled';
          res.writeHead(204);
          return res.end();
        }
        if (inst) {
          const ex = cal.ex.get(inst.recurringEventId) || { exdates: new Set(), overrides: new Map() };
          cal.ex.set(inst.recurringEventId, ex);
          ex.exdates.add(toWall(inst.originalStartTime));
          res.writeHead(204);
          return res.end();
        }
        return gErr(res, 404, 'notFound');
      }
      return gErr(res, 405, 'method');
    } catch (e) {
      console.error('[fake-google]', e);
      return gErr(res, 500, 'backendError');
    }
  });

  return {
    state,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// Execução direta (E2E): node tests/support/fake-google.mjs 4100
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 4100);
  const fake = createFakeGoogle({ defaultEmail: process.env.FAKE_EMAIL || 'eduardo@example.com' });
  fake.listen(port).then((p) => console.log(`fake google on ${p}`));
}
