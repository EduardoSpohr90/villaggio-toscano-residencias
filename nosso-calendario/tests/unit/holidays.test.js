import { describe, it, expect } from 'vitest';
import { easter, localHolidays, mergeHolidays } from '../../shared/holidays.js';

describe('feriados', () => {
  it('Páscoa', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
  });
  it('2026: nacionais móveis, SC e Chapecó', () => {
    const h = localHolidays(2026);
    const at = (d) => h.filter((x) => x.date === d).map((x) => x.name);
    expect(at('2026-04-03')).toContain('Sexta-feira Santa');
    expect(at('2026-02-16')).toContain('Carnaval');
    expect(at('2026-06-04')).toContain('Corpus Christi');
    expect(at('2026-08-16')).toContain('Data Magna de Santa Catarina'); // domingo após 11/08
    expect(at('2026-08-25')).toContain('Aniversário de Chapecó');
    expect(at('2026-11-20')).toContain('Dia da Consciência Negra');
  });
  it('Google prevalece e o local completa SC/Chapecó', () => {
    const google = [{ date: '2026-10-12', name: 'Nossa Senhora Aparecida', kind: 'feriado', scope: 'google', source: 'google' }];
    const m = mergeHolidays(2026, google);
    expect(m.find((x) => x.date === '2026-10-12').source).toBe('google');
    expect(m.find((x) => x.date === '2026-08-25').source).toBe('local');
    expect(m.filter((x) => x.date === '2026-12-25')).toHaveLength(0); // nacional vem só do Google
  });
});
