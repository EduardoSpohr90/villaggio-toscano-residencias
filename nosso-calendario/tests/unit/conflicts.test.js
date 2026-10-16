import { describe, it, expect } from 'vitest';
import { detectConflicts, conflictsFor, freeTogether } from '../../shared/conflicts.js';

const ev = (id, owner, start, end, extra = {}) => ({ id, owner, start, end, allDay: false, title: id, ...extra });

describe('detectConflicts()', () => {
  it('a.start < b.end && b.start < a.end', () => {
    const c = detectConflicts([
      ev('reuniao', 'eduardo', '2026-10-16T18:30', '2026-10-16T19:30'),
      ev('pilates', 'esposa', '2026-10-16T18:00', '2026-10-16T19:00'),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe('ambos');
    expect(new Date(c[0].start).toISOString()).toBe('2026-10-16T21:30:00.000Z');
  });
  it('eventos encostados não conflitam', () => {
    expect(detectConflicts([
      ev('a', 'eduardo', '2026-10-16T09:00', '2026-10-16T10:00'),
      ev('b', 'eduardo', '2026-10-16T10:00', '2026-10-16T11:00'),
    ])).toHaveLength(0);
  });
  it('Casal conflita com compromisso individual (mesma pessoa)', () => {
    const c = detectConflicts([
      ev('jantar', 'casal', '2026-10-16T20:00', '2026-10-16T22:00'),
      ev('voo', 'eduardo', '2026-10-16T21:00', '2026-10-16T23:00'),
    ]);
    expect(c[0].type).toBe('mesma-pessoa');
  });
  it('ignora feriados, dia inteiro e tarefas concluídas', () => {
    expect(detectConflicts([
      ev('a', 'eduardo', '2026-10-12T09:00', '2026-10-12T10:00'),
      { ...ev('feriado', 'casal', '2026-10-12', '2026-10-13'), allDay: true, holiday: true },
      ev('t', 'eduardo', '2026-10-12T09:30', '2026-10-12T09:45', { kind: 'task', taskStatus: 'done' }),
    ])).toHaveLength(0);
  });
  it('alerta no formulário sem bloquear', () => {
    const existing = [ev('a', 'eduardo', '2026-10-16T09:00', '2026-10-16T10:00')];
    const cand = ev('novo', 'eduardo', '2026-10-16T09:30', '2026-10-16T10:30');
    expect(conflictsFor(cand, existing)).toHaveLength(1);
    expect(conflictsFor({ ...cand, id: 'a' }, existing)).toHaveLength(0);
  });
  it('períodos livres juntos (dia útil à noite)', () => {
    const free = freeTogether([ev('a', 'eduardo', '2026-10-14T18:00', '2026-10-14T19:30')], '2026-10-14', 1);
    expect(free).toHaveLength(1);
    expect(new Date(free[0].start).toISOString()).toBe('2026-10-14T22:30:00.000Z'); // 19:30 SP
  });
});
