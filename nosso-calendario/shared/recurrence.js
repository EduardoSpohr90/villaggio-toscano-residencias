// @ts-check
// Recorrência RFC 5545 (subconjunto usado pelo app).
// - buildRRule / parseRRule / describeRRule: formulário <-> 'FREQ=WEEKLY;...'
// - expandOccurrences: expansão local (modo neste aparelho e itens na fila offline)
// - splitRule: "este e os próximos" (encerra a série antiga e calcula a nova)

import {
  addDays, daysInMonth, diffDays, diffMinutesWall, addMinutesWall, makeDate,
  msToWall, startOfWeek, wallToCompactUtc, wallToMs, weekday, MONTHS_SHORT,
} from './dates.js';

export const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const BYDAY_TO_WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WD_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const BYDAY_LABELS = { MO: 'seg', TU: 'ter', WE: 'qua', TH: 'qui', FR: 'sex', SA: 'sáb', SU: 'dom' };

/**
 * @typedef {{ freq: 'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY', interval: number, byDay: string[],
 *   count?: number, until?: string }} Rule
 * until: 'YYYYMMDD' ou 'YYYYMMDDTHHMMSSZ' (como na RFC)
 */

/** @returns {Rule | null} */
export function parseRRule(str) {
  if (!str) return null;
  const s = str.replace(/^RRULE:/, '');
  /** @type {any} */
  const rule = { interval: 1, byDay: [] };
  for (const part of s.split(';')) {
    const [k, v] = part.split('=');
    if (k === 'FREQ') rule.freq = v;
    else if (k === 'INTERVAL') rule.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'COUNT') rule.count = parseInt(v, 10);
    else if (k === 'UNTIL') rule.until = v;
    else if (k === 'BYDAY') rule.byDay = v.split(',').filter((d) => BYDAY.includes(d));
  }
  if (!FREQS.includes(rule.freq)) return null;
  return rule;
}

/** @param {Rule} rule */
export function buildRRule(rule) {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length) {
    const ordered = BYDAY.filter((d) => rule.byDay.includes(d));
    parts.push(`BYDAY=${ordered.join(',')}`);
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${rule.until}`);
  return parts.join(';');
}

/** UNTIL a partir de uma data final escolhida no formulário (inclusiva). */
export function untilFromDate(date, allDay) {
  if (allDay) return date.replace(/-/g, '');
  return wallToCompactUtc(date + 'T23:59');
}

/** Data (YYYY-MM-DD, SP) representada por um UNTIL. */
export function untilToDate(until) {
  if (!until) return '';
  if (until.length === 8) return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const ms = Date.UTC(
    +until.slice(0, 4), +until.slice(4, 6) - 1, +until.slice(6, 8),
    +until.slice(9, 11), +until.slice(11, 13), +until.slice(13, 15),
  );
  return msToWall(ms).slice(0, 10);
}

function untilMs(until) {
  if (!until) return Infinity;
  if (until.length === 8) {
    // Data: inclusiva até o fim do dia em SP
    return wallToMs(`${untilToDate(until)}T23:59`) + 59999;
  }
  return Date.UTC(
    +until.slice(0, 4), +until.slice(4, 6) - 1, +until.slice(6, 8),
    +until.slice(9, 11), +until.slice(11, 13), +until.slice(13, 15),
  );
}

/** Predefinição do formulário a partir de uma regra. */
export function presetOf(rrule) {
  const r = parseRRule(rrule);
  if (!r) return 'none';
  const simple = r.interval === 1 && !r.count && !r.until && (r.freq !== 'WEEKLY' || r.byDay.length <= 1);
  if (!simple) return 'custom';
  return { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[r.freq];
}

/** Texto curto em português: 'Toda semana', 'A cada 2 semanas (seg, qua)', ... */
export function describeRRule(rrule) {
  const r = parseRRule(rrule);
  if (!r) return 'Não repete';
  const n = r.interval;
  const unit = {
    DAILY: n === 1 ? 'Todo dia' : `A cada ${n} dias`,
    WEEKLY: n === 1 ? 'Toda semana' : `A cada ${n} semanas`,
    MONTHLY: n === 1 ? 'Todo mês' : `A cada ${n} meses`,
    YEARLY: n === 1 ? 'Todo ano' : `A cada ${n} anos`,
  }[r.freq];
  let txt = unit;
  if (r.freq === 'WEEKLY' && r.byDay.length > 1) {
    txt += ` (${BYDAY.filter((d) => r.byDay.includes(d)).map((d) => BYDAY_LABELS[d]).join(', ')})`;
  }
  if (r.count) txt += `, ${r.count} vezes`;
  else if (r.until) {
    const d = untilToDate(r.until);
    const [y, m, day] = d.split('-').map(Number);
    txt += `, até ${day} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
  return txt;
}

/**
 * Gera inícios de ocorrência (hora de parede ou data) a partir do início da série.
 * Chama visit(start) em ordem; visit devolve false para parar.
 * @param {{ start: string, allDay: boolean, rrule: string }} master
 * @param {(start: string) => boolean} visit
 */
function iterate(master, visit) {
  const rule = parseRRule(master.rrule);
  if (!rule) {
    visit(master.start);
    return;
  }
  const startDate = master.start.slice(0, 10);
  const time = master.allDay ? '' : master.start.slice(10);
  const limit = untilMs(rule.until);
  let produced = 0;
  const MAX = 5000;
  const emit = (date) => {
    if (date < startDate) return true;
    const start = date + time;
    const ms = master.allDay ? wallToMs(date + 'T00:00') : wallToMs(start);
    if (ms > limit) return false;
    if (rule.count && produced >= rule.count) return false;
    produced++;
    return visit(start) !== false;
  };
  const step = rule.interval;
  if (rule.freq === 'DAILY') {
    for (let k = 0; k < MAX; k++) if (!emit(addDays(startDate, k * step))) return;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay : [WD_TO_BYDAY[weekday(startDate)]];
    const offsets = days
      .map((d) => (BYDAY_TO_WD[d] + 6) % 7) // segunda = 0
      .sort((a, b) => a - b);
    const week0 = startOfWeek(startDate);
    for (let k = 0; k < MAX; k++) {
      const ws = addDays(week0, k * 7 * step);
      for (const off of offsets) if (!emit(addDays(ws, off))) return;
    }
  } else if (rule.freq === 'MONTHLY') {
    const [y, m, d] = startDate.split('-').map(Number);
    for (let k = 0; k < MAX; k++) {
      const total = y * 12 + (m - 1) + k * step;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      if (d > daysInMonth(ny, nm)) continue; // RFC: mês sem o dia é pulado
      if (!emit(makeDate(ny, nm, d))) return;
    }
  } else if (rule.freq === 'YEARLY') {
    const [y, m, d] = startDate.split('-').map(Number);
    for (let k = 0; k < MAX; k++) {
      const ny = y + k * step;
      if (d > daysInMonth(ny, m)) continue; // 29/02 só em ano bissexto
      if (!emit(makeDate(ny, m, d))) return;
    }
  }
}

/** Duração de um evento (minutos ou dias) para replicar nas ocorrências. */
function durationOf(ev) {
  return ev.allDay ? diffDays(ev.start, ev.end) : diffMinutesWall(ev.start, ev.end);
}
function endFor(ev, start, duration) {
  return ev.allDay ? addDays(start, duration) : addMinutesWall(start, duration);
}

/**
 * Ocorrências que tocam o intervalo [fromDate, toDate) (datas, exclusivo no fim).
 * @param {{ start: string, end: string, allDay: boolean, rrule?: string, exdates?: string[] }} master
 * @returns {{ start: string, end: string, originalStart: string }[]}
 */
export function expandOccurrences(master, fromDate, toDate) {
  const duration = durationOf(master);
  const out = [];
  const ex = new Set(master.exdates || []);
  if (!master.rrule) {
    const end = endFor(master, master.start, duration);
    if (master.start.slice(0, 10) < toDate && end.slice(0, 10) >= fromDate) {
      out.push({ start: master.start, end, originalStart: master.start });
    }
    return out;
  }
  iterate(/** @type {any} */ (master), (start) => {
    const date = start.slice(0, 10);
    if (date >= toDate) return false;
    const end = endFor(master, start, duration);
    const endDate = master.allDay ? addDays(end, -1) : end.slice(0, 10);
    if (endDate >= fromDate && !ex.has(start)) out.push({ start, end, originalStart: start });
    return out.length < 2000;
  });
  return out;
}

/** Quantas ocorrências a série gera antes de `occStart`. */
export function countBefore(master, occStart) {
  let n = 0;
  iterate(master, (start) => {
    if (start >= occStart) return false;
    n++;
    return true;
  });
  return n;
}

/** É a primeira ocorrência da série? */
export function isFirstOccurrence(master, occStart) {
  return countBefore(master, occStart) === 0;
}

/**
 * "Este e os próximos": regra da série antiga (encerrada antes da ocorrência)
 * e regra da série nova (com COUNT restante, se havia COUNT).
 * @returns {{ head: string, tail: string | undefined }}
 */
export function splitRule(master, occStart, newRRule) {
  const rule = parseRRule(master.rrule);
  if (!rule) return { head: master.rrule, tail: newRRule };
  const before = countBefore(master, occStart);
  const head = { ...rule };
  delete head.count;
  if (master.allDay) head.until = addDays(occStart.slice(0, 10), -1).replace(/-/g, '');
  else head.until = wallToCompactUtc(addMinutesWall(occStart, -1));
  let tail = newRRule;
  if (tail && rule.count && newRRule === master.rrule) {
    const remaining = Math.max(1, rule.count - before);
    const t = parseRRule(newRRule);
    if (t) tail = buildRRule({ ...t, count: remaining, until: undefined });
  }
  return { head: buildRRule(head), tail };
}

/** ID de instância no padrão do Google: <id>_<YYYYMMDD> ou <id>_<YYYYMMDDTHHMMSSZ>. */
export function instanceId(seriesId, occStart, allDay) {
  return allDay ? `${seriesId}_${occStart.replace(/-/g, '')}` : `${seriesId}_${wallToCompactUtc(occStart)}`;
}
