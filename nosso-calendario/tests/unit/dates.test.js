import { describe, it, expect } from 'vitest';
import {
  wallToMs, msToWall, isoToWall, today, addDays, startOfWeek, addMonths, eventDays,
  diffMinutesWall, addMinutesWall, formatRange, wallToCompactUtc, weekday,
} from '../../shared/dates.js';

describe('datas em America/Sao_Paulo', () => {
  it('o processo de teste roda fora de São Paulo', () => {
    expect(new Date(0).getTimezoneOffset()).toBe(-540); // Tóquio
  });
  it('hora de parede SP <-> instante, sem depender do fuso do aparelho', () => {
    const ms = wallToMs('2026-10-16T09:00');
    expect(new Date(ms).toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(msToWall(ms)).toBe('2026-10-16T09:00');
  });
  it('ISO com offset do Google vira hora de SP', () => {
    expect(isoToWall('2026-10-16T09:00:00-03:00')).toBe('2026-10-16T09:00');
    expect(isoToWall('2026-10-17T02:30:00Z')).toBe('2026-10-16T23:30');
  });
  it('perto da meia-noite: 23:30 de SP já é o dia seguinte em UTC', () => {
    const ms = Date.parse('2026-10-17T02:30:00Z');
    expect(today(ms)).toBe('2026-10-16');
  });
  it('horário de verão histórico (2018: UTC-2)', () => {
    expect(new Date(wallToMs('2018-12-25T10:00')).toISOString()).toBe('2018-12-25T12:00:00.000Z');
    expect(new Date(wallToMs('2018-07-01T10:00')).toISOString()).toBe('2018-07-01T13:00:00.000Z');
  });
  it('aritmética de datas não cai no dia anterior (bug UTC)', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekday('2026-10-16')).toBe(5); // sexta
  });
  it('semana começa na segunda', () => {
    expect(startOfWeek('2026-10-16')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12'); // domingo
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
  });
  it('troca de mês respeita dias do mês', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
  it('dias ocupados por um evento', () => {
    expect(eventDays({ allDay: true, start: '2026-10-16', end: '2026-10-19' })).toEqual([
      '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    expect(eventDays({ allDay: false, start: '2026-10-16T22:00', end: '2026-10-17T00:00' })).toEqual(['2026-10-16']);
    expect(eventDays({ allDay: false, start: '2026-10-16T22:00', end: '2026-10-17T01:00' })).toEqual([
      '2026-10-16', '2026-10-17',
    ]);
  });
  it('minutos entre horas de parede e soma atravessando o dia', () => {
    expect(diffMinutesWall('2026-10-16T09:00', '2026-10-16T11:30')).toBe(150);
    expect(addMinutesWall('2026-10-16T23:30', 60)).toBe('2026-10-17T00:30');
  });
  it('UNTIL / ID de instância em UTC compacto', () => {
    expect(wallToCompactUtc('2026-10-16T09:00')).toBe('20261016T120000Z');
  });
  it('faixa legível', () => {
    expect(formatRange({ allDay: false, start: '2026-10-16T09:00', end: '2026-10-16T11:30' })).toBe('09:00–11:30');
    expect(formatRange({ allDay: true, start: '2026-10-16', end: '2026-10-17' })).toBe('Dia inteiro');
  });
});
