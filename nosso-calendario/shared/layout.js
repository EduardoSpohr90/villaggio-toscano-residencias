// @ts-check
// Posicionamento proporcional na grade da semana e filtros.

import { timeToMin, eventDays } from './dates.js';

export const GRID_START_MIN = 6 * 60; // 06:00
export const GRID_END_MIN = 23 * 60; // 23:00
export const MIN_BLOCK_MIN = 20; // altura mínima legível

/**
 * Segmento de um evento com horário dentro de um dia, recortado à grade.
 * top/height em minutos a partir de 06:00.
 * @param {{ start: string, end: string, allDay: boolean }} ev
 * @param {string} date
 */
export function segmentForDay(ev, date) {
  if (ev.allDay) return null;
  const sd = ev.start.slice(0, 10);
  const ed = ev.end.slice(0, 10);
  if (date < sd || date > ed) return null;
  let s = date === sd ? timeToMin(ev.start.slice(11)) : 0;
  let e = date === ed ? timeToMin(ev.end.slice(11)) : 1440;
  if (e <= s) return null;
  const realStart = s;
  const realEnd = e;
  s = Math.max(GRID_START_MIN, Math.min(s, GRID_END_MIN - MIN_BLOCK_MIN));
  e = Math.min(GRID_END_MIN, Math.max(e, s + MIN_BLOCK_MIN));
  return {
    top: s - GRID_START_MIN,
    height: Math.max(MIN_BLOCK_MIN, e - s),
    clippedTop: realStart < GRID_START_MIN,
    clippedBottom: realEnd > GRID_END_MIN,
  };
}

/**
 * Distribui eventos simultâneos lado a lado.
 * Retorna, para cada item, a coluna e o total de colunas do seu grupo.
 * @template {{ top: number, height: number }} T
 * @param {T[]} items
 * @returns {(T & { col: number, cols: number })[]}
 */
export function packColumns(items) {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.height - a.height);
  /** @type {(T & { col: number, cols: number })[]} */
  const out = [];
  /** @type {(T & { col: number, cols: number })[]} */
  let cluster = [];
  /** @type {number[]} */
  let colEnds = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = colEnds.length;
    for (const it of cluster) it.cols = n;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const item of sorted) {
    if (item.top >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((end) => end <= item.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(0);
    }
    colEnds[col] = item.top + item.height;
    const placed = /** @type {any} */ ({ ...item, col, cols: 1 });
    cluster.push(placed);
    clusterEnd = Math.max(clusterEnd, item.top + item.height);
  }
  if (cluster.length) flush();
  return out;
}

/**
 * Filtros combináveis: pessoas (vazio = todos) E categorias (vazio = todas).
 * @param {{ owner: string, category: string }} ev
 * @param {{ people: string[], categories: string[] }} f
 */
export function matchesFilters(ev, f) {
  if (f.people.length && !f.people.includes(ev.owner)) return false;
  if (f.categories.length && !f.categories.includes(ev.category)) return false;
  return true;
}

/** Agrupa eventos por dia (YYYY-MM-DD), em ordem de início. */
export function groupByDay(events) {
  /** @type {Map<string, any[]>} */
  const map = new Map();
  for (const ev of events) {
    for (const d of eventDays(ev)) {
      let list = map.get(d);
      if (!list) map.set(d, (list = []));
      list.push(ev);
    }
  }
  for (const list of map.values()) list.sort(compareEvents);
  return map;
}

/** Dia inteiro primeiro, depois por horário, depois por título. */
export function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return (a.title || '').localeCompare(b.title || '', 'pt-BR');
}
