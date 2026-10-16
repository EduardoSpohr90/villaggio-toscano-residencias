// @ts-check
// Regras de negócio sobre a Google Calendar API: calendário da família,
// leitura por intervalo, CRUD com escopo de recorrência, feriados e
// disponibilidade (free/busy) de agendas individuais.

import { randomBytes } from 'node:crypto';
import { gapi, GoogleError } from './google.js';
import { HttpError } from './http.js';
import { HOLIDAY_CALENDAR_ID } from './config.js';
import { toGoogle, fromGoogle } from '../../shared/gcal.js';
import { TZ, isEventId, bytesToBase32hex } from '../../shared/model.js';
import {
  wallToMs, isoToWall, addDays, diffDays, diffMinutesWall, addMinutesWall,
} from '../../shared/dates.js';
import { splitRule, isFirstOccurrence } from '../../shared/recurrence.js';
import { classifyGoogleHoliday, localHolidays } from '../../shared/holidays.js';

const enc = encodeURIComponent;

/** ID do calendário da família: variável de ambiente, sessão ou busca pelo nome. */
export async function resolveCalendar(ctx, { required = true } = {}) {
  const { cfg, session } = ctx;
  if (cfg.calendarId) return { id: cfg.calendarId, summary: cfg.calendarName };
  if (session.calId) return { id: session.calId, summary: session.calName || cfg.calendarName };
  const wanted = cfg.calendarName.trim().toLowerCase();
  let pageToken;
  const matches = [];
  do {
    const data = await gapi(ctx, '/users/me/calendarList', { query: { maxResults: 250, pageToken, minAccessRole: 'writer' } });
    for (const c of data.items || []) {
      const names = [c.summary, c.summaryOverride].filter(Boolean).map((s) => String(s).trim().toLowerCase());
      if (names.includes(wanted)) matches.push(c);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  matches.sort((a, b) => (a.accessRole === 'owner' ? -1 : 0) - (b.accessRole === 'owner' ? -1 : 0));
  if (!matches.length) {
    if (!required) return null;
    throw new HttpError(409, 'no_calendar', `Calendário "${cfg.calendarName}" não encontrado.`);
  }
  session.calId = matches[0].id;
  session.calName = matches[0].summaryOverride || matches[0].summary;
  ctx.save();
  return { id: matches[0].id, summary: session.calName };
}

/** Cria o calendário da família e compartilha com as demais pessoas permitidas. */
export async function setupCalendar(ctx) {
  const existing = await resolveCalendar(ctx, { required: false });
  if (existing) return { ...existing, created: false, shared: [] };
  const cal = await gapi(ctx, '/calendars', {
    method: 'POST',
    body: {
      summary: ctx.cfg.calendarName,
      timeZone: TZ,
      description: 'Agenda compartilhada da família — usada pelo Nosso Calendário.',
    },
  });
  const shared = [];
  for (const email of ctx.cfg.allowedUsers.keys()) {
    if (email === ctx.session.email) continue;
    await gapi(ctx, `/calendars/${enc(cal.id)}/acl`, {
      method: 'POST',
      query: { sendNotifications: true },
      body: { role: 'writer', scope: { type: 'user', value: email } },
    });
    shared.push(email);
  }
  ctx.session.calId = cal.id;
  ctx.session.calName = cal.summary;
  ctx.save();
  return { id: cal.id, summary: cal.summary, created: true, shared };
}

function rangeToIso(fromDate, toDate) {
  return {
    timeMin: new Date(wallToMs(`${fromDate}T00:00`)).toISOString(),
    timeMax: new Date(wallToMs(`${toDate}T00:00`)).toISOString(),
  };
}

async function listAll(ctx, calId, query) {
  const items = [];
  let pageToken;
  let guard = 0;
  do {
    const data = await gapi(ctx, `/calendars/${enc(calId)}/events`, { query: { ...query, pageToken, maxResults: 2500 } });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken && ++guard < 10);
  return items;
}

/** Eventos do intervalo [from, to) com recorrências expandidas pelo Google. */
export async function listEvents(ctx, calId, fromDate, toDate) {
  const { timeMin, timeMax } = rangeToIso(fromDate, toDate);
  const [instances, masters] = await Promise.all([
    listAll(ctx, calId, { singleEvents: true, orderBy: 'startTime', timeMin, timeMax, showDeleted: false }),
    // As instâncias não trazem a regra; a lista sem expansão traz as séries.
    listAll(ctx, calId, { singleEvents: false, timeMin, timeMax, showDeleted: false }),
  ]);
  /** @type {Record<string, string>} */
  const rules = {};
  for (const m of masters) {
    const r = Array.isArray(m.recurrence) && m.recurrence.find((x) => x.startsWith('RRULE:'));
    if (r) rules[m.id] = r.slice(6);
  }
  return instances.map((g) => fromGoogle(g, rules)).filter(Boolean);
}

async function getEvent(ctx, calId, id) {
  try {
    return await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(id)}`);
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

function newId() {
  return bytesToBase32hex(randomBytes(16));
}

/**
 * Criação idempotente: o ID vem do cliente. Repetir o envio (fila offline,
 * migração em dois aparelhos) devolve o evento existente em vez de duplicar.
 */
export async function createEvent(ctx, calId, input, { id, migrationId } = {}) {
  const eventId = id && isEventId(id) ? id : newId();
  const body = toGoogle(input, { id: eventId, by: ctx.session.email, migrationId });
  try {
    const g = await gapi(ctx, `/calendars/${enc(calId)}/events`, { method: 'POST', body });
    return { event: fromGoogle(g, input.rrule ? { [g.id]: input.rrule } : {}), duplicate: false };
  } catch (e) {
    if (e instanceof GoogleError && e.status === 409) {
      const g = await getEvent(ctx, calId, eventId);
      return { event: g ? fromGoogle(g) : null, duplicate: true };
    }
    throw e;
  }
}

function masterToApp(master) {
  return fromGoogle(master);
}

/** Novo início/fim da série ao editar "toda a série" a partir de uma ocorrência. */
function shiftSeries(masterApp, occStart, input) {
  const dateDelta = diffDays(occStart.slice(0, 10), input.start.slice(0, 10));
  const masterDate = addDays(masterApp.start.slice(0, 10), dateDelta);
  if (input.allDay) {
    const days = diffDays(input.start, input.end);
    return { start: masterDate, end: addDays(masterDate, days) };
  }
  const start = `${masterDate}T${input.start.slice(11)}`;
  return { start, end: addMinutesWall(start, diffMinutesWall(input.start, input.end)) };
}

/**
 * @param {'this'|'following'|'all'} scope
 * @param {{ seriesId?: string, originalStart?: string, newId?: string }} hints
 */
export async function updateEvent(ctx, calId, id, input, scope, hints = {}) {
  const by = ctx.session.email;
  const g = await getEvent(ctx, calId, id);
  const seriesId = (g && g.recurringEventId) || hints.seriesId;
  if (!seriesId) {
    if (!g) throw new HttpError(404, 'not_found', 'Compromisso não encontrado. Ele pode ter sido excluído.');
    const patched = await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(id)}`, {
      method: 'PATCH',
      body: toGoogle(input, { by }),
    });
    return { event: fromGoogle(patched, input.rrule ? { [patched.id]: input.rrule } : {}) };
  }
  const occStart = g && g.originalStartTime
    ? (g.originalStartTime.date || isoToWall(g.originalStartTime.dateTime))
    : hints.originalStart;
  if (scope === 'this') {
    if (!g) throw new HttpError(404, 'not_found', 'Compromisso não encontrado. Ele pode ter sido excluído.');
    const patched = await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(id)}`, {
      method: 'PATCH',
      body: toGoogle(input, { by, includeRecurrence: false }),
    });
    return { event: fromGoogle(patched) };
  }
  const master = await getEvent(ctx, calId, seriesId);
  if (!master) throw new HttpError(404, 'not_found', 'Série não encontrada. Ela pode ter sido excluída.');
  const masterApp = masterToApp(master);
  if (!masterApp || !occStart) throw new HttpError(409, 'series', 'Não foi possível identificar a ocorrência.');
  if (scope === 'all' || isFirstOccurrence(masterApp, occStart)) {
    const span = shiftSeries(masterApp, occStart, input);
    const patched = await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(seriesId)}`, {
      method: 'PATCH',
      body: toGoogle({ ...input, ...span }, { by }),
    });
    return { event: fromGoogle(patched) };
  }
  // "Este e os próximos": encerra a série antiga antes da ocorrência e cria
  // uma nova a partir dela. Repetível: o ID da nova série vem do cliente.
  const { head, tail } = splitRule(masterApp, occStart, input.rrule);
  const currentRule = (master.recurrence || []).find((r) => r.startsWith('RRULE:'));
  if (currentRule !== `RRULE:${head}`) {
    await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(seriesId)}`, {
      method: 'PATCH',
      body: { recurrence: [`RRULE:${head}`] },
    });
  }
  const created = await createEvent(ctx, calId, { ...input, rrule: tail }, { id: hints.newId });
  return { event: created.event, split: true };
}

/** @param {'this'|'following'|'all'} scope */
export async function deleteEvent(ctx, calId, id, scope, hints = {}) {
  const g = await getEvent(ctx, calId, id);
  const seriesId = (g && g.recurringEventId) || hints.seriesId;
  const del = async (eid) => {
    try {
      await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(eid)}`, { method: 'DELETE' });
    } catch (e) {
      // Já excluído (por outra pessoa ou por um reenvio da fila): sucesso.
      if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
    }
  };
  if (!seriesId || scope === 'this') {
    if (g && g.status !== 'cancelled') await del(id);
    return { deleted: true };
  }
  if (scope === 'all') {
    await del(seriesId);
    return { deleted: true };
  }
  const master = await getEvent(ctx, calId, seriesId);
  if (!master) return { deleted: true };
  const masterApp = masterToApp(master);
  const occStart = g && g.originalStartTime
    ? (g.originalStartTime.date || isoToWall(g.originalStartTime.dateTime))
    : hints.originalStart;
  if (!masterApp || !occStart || isFirstOccurrence(masterApp, occStart)) {
    await del(seriesId);
    return { deleted: true };
  }
  const { head } = splitRule(masterApp, occStart, masterApp.rrule);
  await gapi(ctx, `/calendars/${enc(calId)}/events/${enc(seriesId)}`, {
    method: 'PATCH',
    body: { recurrence: [`RRULE:${head}`] },
  });
  return { deleted: true };
}

/** Feriados do ano a partir do calendário público do Google. */
export async function listHolidays(ctx, year) {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const items = await listAll(ctx, HOLIDAY_CALENDAR_ID, {
    singleEvents: true, orderBy: 'startTime', timeMin: `${from}T00:00:00Z`, timeMax: `${to}T00:00:00Z`,
  });
  const local = localHolidays(year);
  return items
    .filter((g) => g.start && g.start.date && g.start.date >= from && g.start.date < to)
    .map((g) => ({
      date: g.start.date,
      name: String(g.summary || '').slice(0, 120),
      kind: classifyGoogleHoliday(g.summary, g.description, g.start.date, local),
      scope: 'google',
      source: 'google',
    }));
}

/**
 * Agendas individuais como "Ocupado": o free/busy do Google devolve apenas
 * intervalos, nunca título ou descrição. O próprio Google aplica a permissão
 * de cada agenda (quem não compartilhou disponibilidade não aparece).
 */
export async function freeBusy(ctx, fromDate, toDate) {
  const sources = ctx.cfg.busySources;
  if (!sources.length) return { enabled: false, blocks: [], unavailable: [] };
  const { timeMin, timeMax } = rangeToIso(fromDate, toDate);
  const data = await gapi(ctx, '/freeBusy', {
    method: 'POST',
    body: { timeMin, timeMax, timeZone: TZ, items: sources.map((s) => ({ id: s.calendar })) },
  });
  const blocks = [];
  const unavailable = [];
  sources.forEach((s, idx) => {
    const c = data.calendars && data.calendars[s.calendar];
    if (!c || (c.errors && c.errors.length)) {
      unavailable.push(s.person);
      return;
    }
    for (const b of c.busy || []) {
      blocks.push({
        id: `busy-${idx}-${Date.parse(b.start)}`,
        owner: s.person,
        start: isoToWall(b.start),
        end: isoToWall(b.end),
      });
    }
  });
  return { enabled: true, blocks, unavailable: [...new Set(unavailable)] };
}
