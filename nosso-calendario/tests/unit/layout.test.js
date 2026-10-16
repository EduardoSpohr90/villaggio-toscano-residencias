import { describe, it, expect } from 'vitest';
import { segmentForDay, packColumns, matchesFilters } from '../../shared/layout.js';

describe('semana proporcional', () => {
  it('09:00–11:30 ocupa 2h30 a partir de 06:00', () => {
    const s = segmentForDay({ allDay: false, start: '2026-10-16T09:00', end: '2026-10-16T11:30' }, '2026-10-16');
    expect(s).toMatchObject({ top: 180, height: 150 });
  });
  it('recorta à grade 06–23 e marca o corte', () => {
    const s = segmentForDay({ allDay: false, start: '2026-10-16T05:00', end: '2026-10-16T07:00' }, '2026-10-16');
    expect(s).toMatchObject({ top: 0, height: 60, clippedTop: true });
  });
  it('simultâneos lado a lado', () => {
    const p = packColumns([
      { id: 'a', top: 0, height: 120 }, { id: 'b', top: 60, height: 60 }, { id: 'c', top: 200, height: 30 },
    ]);
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by.a).toMatchObject({ col: 0, cols: 2 });
    expect(by.b).toMatchObject({ col: 1, cols: 2 });
    expect(by.c).toMatchObject({ col: 0, cols: 1 });
  });
  it('filtros combinados: pessoa + categoria', () => {
    const f = { people: ['eduardo'], categories: ['trabalho'] };
    expect(matchesFilters({ owner: 'eduardo', category: 'trabalho' }, f)).toBe(true);
    expect(matchesFilters({ owner: 'eduardo', category: 'lazer' }, f)).toBe(false);
    expect(matchesFilters({ owner: 'casal', category: 'viagens' }, { people: ['casal'], categories: ['viagens'] })).toBe(true);
    expect(matchesFilters({ owner: 'esposa', category: 'casa' }, { people: [], categories: [] })).toBe(true);
  });
});
