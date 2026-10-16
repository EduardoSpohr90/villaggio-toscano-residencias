// Conversão entre o modelo do app e o recurso Event do Google Calendar.
// Metadados do app vão em extendedProperties.private — nunca no título.

import {
  TZ, PEOPLE, CATEGORIES, REMINDERS, GOOGLE_COLOR_BY_PERSON, GOOGLE_COLOR_TASK_DONE,
} from './model.js';
import { isoToWall } from './dates.js';

export const APP_SOURCE = 'nosso-calendario';

/**
 * @param {import('./types').EventInput} ev
 * @param {{ id?: string, by?: string, migrationId?: string, includeRecurrence?: boolean }} [opts]
 */
export function toGoogle(ev, opts = {}) {
  /** @type {Record<string, string>} */
  const priv = {
    nc_owner: ev.owner,
    nc_category: ev.category,
    nc_kind: ev.kind,
    nc_source: APP_SOURCE,
  };
  if (ev.kind === 'task') priv.nc_task = ev.taskStatus === 'done' ? 'done' : 'pending';
  if (opts.by) priv.nc_by = opts.by;
  if (opts.migrationId) priv.nc_migration = opts.migrationId;
  /** @type {any} */
  const g = {
    summary: ev.title,
    description: ev.notes || '',
    location: ev.location || '',
    start: ev.allDay ? { date: ev.start } : { dateTime: `${ev.start}:00`, timeZone: TZ },
    end: ev.allDay ? { date: ev.end } : { dateTime: `${ev.end}:00`, timeZone: TZ },
    reminders: {
      useDefault: false,
      overrides: ev.reminder && ev.reminder !== 'none' ? [{ method: 'popup', minutes: Number(ev.reminder) }] : [],
    },
    colorId: ev.kind === 'task' && ev.taskStatus === 'done' ? GOOGLE_COLOR_TASK_DONE : GOOGLE_COLOR_BY_PERSON[ev.owner],
    extendedProperties: { private: priv },
  };
  if (opts.id) g.id = opts.id;
  if (opts.includeRecurrence !== false) {
    g.recurrence = ev.rrule ? [`RRULE:${ev.rrule}`, ...exdateLines(ev)] : [];
  }
  return g;
}

function exdateLines(ev) {
  if (!ev.exdates || !ev.exdates.length) return [];
  if (ev.allDay) return [`EXDATE;VALUE=DATE:${ev.exdates.map((d) => d.replace(/-/g, '')).join(',')}`];
  const stamp = (w) => `${w.replace(/-/g, '').replace(':', '')}00`;
  return [`EXDATE;TZID=${TZ}:${ev.exdates.map(stamp).join(',')}`];
}

const PERSON_BY_COLOR = Object.fromEntries(Object.entries(GOOGLE_COLOR_BY_PERSON).map(([p, c]) => [c, p]));

/** Descrição criada no Google pode vir em HTML; o app exibe texto puro. */
export function htmlToText(s) {
  if (!s) return '';
  if (!/[<&]/.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nearestReminder(g) {
  const o = g.reminders && Array.isArray(g.reminders.overrides) ? g.reminders.overrides : [];
  if (!o.length) return 'none';
  const min = Math.min(...o.map((x) => Number(x.minutes) || 0));
  const options = REMINDERS.filter((r) => r !== 'none').map(Number);
  let best = options[0];
  for (const opt of options) if (Math.abs(opt - min) < Math.abs(best - min)) best = opt;
  return String(best);
}

function timeOf(t) {
  if (!t) return '';
  if (t.date) return t.date;
  return isoToWall(t.dateTime);
}

/**
 * @param {any} g recurso Event do Google
 * @param {Record<string, string>} [rulesBySeries] RRULE da série, por ID
 * @returns {import('./types').CalEvent | null}
 */
export function fromGoogle(g, rulesBySeries = {}) {
  if (!g || g.status === 'cancelled' || !g.start || !g.end) return null;
  const priv = (g.extendedProperties && g.extendedProperties.private) || {};
  const allDay = !!g.start.date;
  const owner = PEOPLE.includes(priv.nc_owner) ? priv.nc_owner : PERSON_BY_COLOR[g.colorId] || 'casal';
  const category = CATEGORIES.includes(priv.nc_category) ? priv.nc_category : 'familia';
  const kind = priv.nc_kind === 'task' ? 'task' : 'event';
  const own = Array.isArray(g.recurrence) ? g.recurrence.find((r) => r.startsWith('RRULE:')) : undefined;
  const rrule = own ? own.slice(6) : g.recurringEventId ? rulesBySeries[g.recurringEventId] : undefined;
  return {
    id: g.id,
    seriesId: g.recurringEventId || undefined,
    originalStart: g.originalStartTime ? timeOf(g.originalStartTime) : undefined,
    title: g.summary || '(sem título)',
    owner,
    category,
    kind,
    taskStatus: kind === 'task' ? (priv.nc_task === 'done' ? 'done' : 'pending') : undefined,
    allDay,
    start: timeOf(g.start),
    end: timeOf(g.end),
    location: g.location || '',
    notes: htmlToText(g.description || ''),
    reminder: /** @type {any} */ (nearestReminder(g)),
    rrule: rrule || undefined,
    source: 'google',
    updated: g.updated,
    createdBy: priv.nc_by || (g.creator && g.creator.email) || undefined,
  };
}
