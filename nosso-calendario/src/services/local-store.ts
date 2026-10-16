// Agenda "neste aparelho": usada enquanto o Google não está conectado.
// Mesmas regras de recorrência do servidor (shared/recurrence.js).

import type { CalEvent, EventInput } from '../../shared/types';
import {
  expandOccurrences, instanceId, splitRule, isFirstOccurrence, shiftSeries,
} from '../../shared/recurrence.js';

export type Scope = 'this' | 'following' | 'all';

/** Expande séries locais no intervalo [from, to). */
export function expandLocal(list: CalEvent[], from: string, to: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const ev of list) {
    if (ev.rrule && !ev.seriesId) {
      for (const o of expandOccurrences(ev, from, to)) {
        out.push({
          ...ev,
          id: instanceId(ev.id, o.originalStart, ev.allDay),
          seriesId: ev.id,
          originalStart: o.originalStart,
          start: o.start,
          end: o.end,
          exdates: undefined,
        });
      }
    } else if (expandOccurrences({ ...ev, rrule: undefined }, from, to).length) {
      out.push(ev);
    }
  }
  return out;
}

function strip(input: EventInput): EventInput {
  const { exdates: _ignored, ...rest } = input as EventInput & { exdates?: string[] };
  return rest;
}

export function createLocal(list: CalEvent[], input: EventInput, id: string): CalEvent[] {
  return [...list, { ...input, id, source: 'local' }];
}

export function updateLocal(list: CalEvent[], target: CalEvent, input: EventInput, scope: Scope, newId: string): CalEvent[] {
  const master = target.seriesId ? list.find((e) => e.id === target.seriesId) : undefined;
  if (!target.seriesId || !master || !target.originalStart) {
    return list.map((e) => (e.id === target.id ? { ...e, ...input, id: e.id, source: 'local' } : e));
  }
  const occ = target.originalStart;
  if (scope === 'this') {
    const exdates = Array.from(new Set([...(master.exdates || []), occ]));
    return [
      ...list.filter((e) => e.id !== target.id).map((e) => (e.id === master.id ? { ...e, exdates } : e)),
      { ...strip(input), rrule: undefined, id: target.id, seriesId: master.id, originalStart: occ, source: 'local' },
    ];
  }
  if (scope === 'all' || isFirstOccurrence(master, occ)) {
    const span = shiftSeries(master, occ, input);
    return list.map((e) =>
      e.id === master.id ? { ...e, ...strip(input), ...span, rrule: input.rrule, exdates: master.exdates, id: master.id, source: 'local' } : e,
    );
  }
  const { head, tail } = splitRule(master, occ, input.rrule);
  return [
    ...list
      .filter((e) => !(e.seriesId === master.id && e.originalStart && e.originalStart >= occ))
      .map((e) => (e.id === master.id ? { ...e, rrule: head } : e)),
    { ...strip(input), rrule: tail, id: newId, source: 'local' },
  ];
}

export function deleteLocal(list: CalEvent[], target: CalEvent, scope: Scope): CalEvent[] {
  const master = target.seriesId ? list.find((e) => e.id === target.seriesId) : undefined;
  if (!target.seriesId || !master || !target.originalStart) return list.filter((e) => e.id !== target.id);
  const occ = target.originalStart;
  if (scope === 'this') {
    const exdates = Array.from(new Set([...(master.exdates || []), occ]));
    return list.filter((e) => e.id !== target.id).map((e) => (e.id === master.id ? { ...e, exdates } : e));
  }
  if (scope === 'all' || isFirstOccurrence(master, occ)) {
    return list.filter((e) => e.id !== master.id && e.seriesId !== master.id);
  }
  const { head } = splitRule(master, occ, master.rrule);
  return list
    .filter((e) => !(e.seriesId === master.id && e.originalStart && e.originalStart >= occ))
    .map((e) => (e.id === master.id ? { ...e, rrule: head } : e));
}
