// @ts-check
// Conflitos e períodos livres. Função central usada pela semana, pelo
// formulário (alerta antes de salvar) e pela "Semana do casal".

import { eventRangeMs, wallToMs, addDays, weekday } from './dates.js';

/**
 * @typedef {{ id: string, owner: string, start: string, end: string, allDay: boolean,
 *   title?: string, kind?: string, taskStatus?: string, holiday?: boolean, busy?: boolean }} Timed
 * @typedef {{ a: Timed, b: Timed, start: number, end: number,
 *   type: 'mesma-pessoa' | 'ambos' }} Conflict
 */

/** Entra no cálculo de conflito? Feriados e dia inteiro ficam fora. */
export function countsForConflicts(ev) {
  if (ev.holiday) return false;
  if (ev.allDay) return false;
  if (ev.kind === 'task' && ev.taskStatus === 'done') return false;
  return true;
}

/** Pessoas efetivamente ocupadas por um item ('casal' ocupa os dois). */
export function peopleOf(owner) {
  return owner === 'casal' ? ['eduardo', 'esposa'] : [owner];
}

/**
 * Conflito: a.start < b.end && b.start < a.end.
 * - 'mesma-pessoa': alguém em dois lugares ao mesmo tempo (inclui Casal)
 * - 'ambos': Eduardo e Esposa ocupados em compromissos separados
 * @param {Timed[]} events
 * @returns {Conflict[]}
 */
export function detectConflicts(events) {
  const items = events
    .filter(countsForConflicts)
    .map((ev) => {
      const [s, e] = eventRangeMs(ev);
      return { ev, s, e };
    })
    .filter((x) => x.e > x.s)
    .sort((x, y) => x.s - y.s || y.e - x.e);
  /** @type {Conflict[]} */
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const B = items[j];
      if (B.s >= A.e) break; // ordenado por início: nenhum outro sobrepõe A
      if (A.s < B.e && B.s < A.e) {
        if (A.ev.busy && B.ev.busy) continue; // dois blocos "Ocupado" não informam nada
        const pa = peopleOf(A.ev.owner);
        const pb = peopleOf(B.ev.owner);
        const shared = pa.some((p) => pb.includes(p));
        out.push({
          a: A.ev,
          b: B.ev,
          start: Math.max(A.s, B.s),
          end: Math.min(A.e, B.e),
          type: shared ? 'mesma-pessoa' : 'ambos',
        });
      }
    }
  }
  return out;
}

/** Conflitos de um evento candidato (formulário) com os existentes. */
export function conflictsFor(candidate, events) {
  if (!countsForConflicts(candidate)) return [];
  const others = events.filter((e) => e.id !== candidate.id);
  return detectConflicts([candidate, ...others]).filter((c) => c.a === candidate || c.b === candidate);
}

/**
 * Janelas em que os dois estão livres ao mesmo tempo.
 * Dias úteis: 18:00–22:30. Fim de semana e feriado: 08:00–22:30.
 * @param {Timed[]} events
 * @param {string} fromDate primeiro dia (inclusivo)
 * @param {number} days quantidade de dias
 * @param {{ minMinutes?: number, holidays?: Set<string>, now?: number }} [opts]
 */
export function freeTogether(events, fromDate, days, opts = {}) {
  const minMs = (opts.minMinutes ?? 120) * 60000;
  const now = opts.now ?? 0;
  const busy = events
    .filter(countsForConflicts)
    .map((e) => eventRangeMs(e))
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const wd = weekday(date);
    const relaxed = wd === 0 || wd === 6 || (opts.holidays && opts.holidays.has(date));
    let s = wallToMs(`${date}T${relaxed ? '08:00' : '18:00'}`);
    const e = wallToMs(`${date}T22:30`);
    if (now > s) s = Math.ceil(now / 1800000) * 1800000; // a partir da próxima meia hora
    let cursor = s;
    for (const [bs, be] of busy) {
      if (be <= cursor) continue;
      if (bs >= e) break;
      if (bs - cursor >= minMs) out.push({ date, start: cursor, end: bs });
      cursor = Math.max(cursor, be);
      if (cursor >= e) break;
    }
    if (e - cursor >= minMs) out.push({ date, start: cursor, end: e });
  }
  return out;
}
