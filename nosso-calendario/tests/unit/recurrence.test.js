import { describe, it, expect } from 'vitest';
import {
  buildRRule, parseRRule, describeRRule, expandOccurrences, splitRule, countBefore,
  presetOf, untilFromDate, untilToDate, instanceId,
} from '../../shared/recurrence.js';

const weekly = { start: '2026-10-12T19:00', end: '2026-10-12T20:00', allDay: false, rrule: 'FREQ=WEEKLY' };

describe('recorrência RFC 5545', () => {
  it('gera RRULE a partir do formulário', () => {
    expect(buildRRule({ freq: 'WEEKLY', interval: 1, byDay: [] })).toBe('FREQ=WEEKLY');
    expect(buildRRule({ freq: 'WEEKLY', interval: 2, byDay: ['WE', 'MO'] })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(buildRRule({ freq: 'DAILY', interval: 1, byDay: [], count: 5 })).toBe('FREQ=DAILY;COUNT=5');
    expect(buildRRule({ freq: 'MONTHLY', interval: 1, byDay: [], until: '20261231' })).toBe('FREQ=MONTHLY;UNTIL=20261231');
  });
  it('lê RRULE com ou sem prefixo', () => {
    expect(parseRRule('RRULE:FREQ=YEARLY;INTERVAL=2')).toMatchObject({ freq: 'YEARLY', interval: 2 });
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
  });
  it('descreve em português', () => {
    expect(describeRRule('FREQ=WEEKLY')).toBe('Toda semana');
    expect(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe('A cada 2 semanas (seg, qua)');
    expect(describeRRule('FREQ=DAILY;COUNT=3')).toBe('Todo dia, 3 vezes');
    expect(describeRRule('FREQ=MONTHLY;UNTIL=20261231')).toBe('Todo mês, até 31 dez 2026');
  });
  it('predefinições', () => {
    expect(presetOf('')).toBe('none');
    expect(presetOf('FREQ=DAILY')).toBe('daily');
    expect(presetOf('FREQ=WEEKLY;INTERVAL=2')).toBe('custom');
  });
  it('diário com COUNT', () => {
    const occ = expandOccurrences({ ...weekly, rrule: 'FREQ=DAILY;COUNT=3' }, '2026-10-01', '2026-11-01');
    expect(occ.map((o) => o.start)).toEqual(['2026-10-12T19:00', '2026-10-13T19:00', '2026-10-14T19:00']);
  });
  it('semanal mantém duração e hora de parede', () => {
    const occ = expandOccurrences(weekly, '2026-10-12', '2026-11-01');
    expect(occ.map((o) => o.start)).toEqual([
      '2026-10-12T19:00', '2026-10-19T19:00', '2026-10-26T19:00',
    ]);
    expect(occ[1].end).toBe('2026-10-19T20:00');
  });
  it('semanal com vários dias e intervalo', () => {
    const occ = expandOccurrences(
      { ...weekly, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH' }, '2026-10-12', '2026-11-01',
    );
    expect(occ.map((o) => o.start.slice(0, 10))).toEqual(['2026-10-12', '2026-10-15', '2026-10-26', '2026-10-29']);
  });
  it('mensal pula mês sem o dia 31', () => {
    const m = { start: '2026-01-31', end: '2026-02-01', allDay: true, rrule: 'FREQ=MONTHLY;COUNT=4' };
    expect(expandOccurrences(m, '2026-01-01', '2027-01-01').map((o) => o.start)).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31',
    ]);
  });
  it('anual em 29/02 só em ano bissexto', () => {
    const y = { start: '2028-02-29', end: '2028-03-01', allDay: true, rrule: 'FREQ=YEARLY' };
    expect(expandOccurrences(y, '2028-01-01', '2033-01-01').map((o) => o.start)).toEqual(['2028-02-29', '2032-02-29']);
  });
  it('UNTIL inclusivo e EXDATE', () => {
    const until = untilFromDate('2026-10-26', false);
    const occ = expandOccurrences(
      { ...weekly, rrule: `FREQ=WEEKLY;UNTIL=${until}`, exdates: ['2026-10-19T19:00'] }, '2026-10-01', '2026-12-01',
    );
    expect(occ.map((o) => o.start)).toEqual(['2026-10-12T19:00', '2026-10-26T19:00']);
    expect(untilToDate(until)).toBe('2026-10-26');
  });
  it('"este e os próximos" encerra a série antiga e preserva o COUNT restante', () => {
    const m = { ...weekly, rrule: 'FREQ=WEEKLY;COUNT=5' };
    expect(countBefore(m, '2026-10-26T19:00')).toBe(2);
    const { head, tail } = splitRule(m, '2026-10-26T19:00', m.rrule);
    expect(head).toBe('FREQ=WEEKLY;UNTIL=20261026T215900Z');
    expect(tail).toBe('FREQ=WEEKLY;COUNT=3');
    const old = expandOccurrences({ ...m, rrule: head }, '2026-10-01', '2027-01-01');
    expect(old).toHaveLength(2);
  });
  it('ID de instância no padrão do Google', () => {
    expect(instanceId('abc123', '2026-10-12T19:00', false)).toBe('abc123_20261012T220000Z');
    expect(instanceId('abc123', '2026-10-12', true)).toBe('abc123_20261012');
  });
});
