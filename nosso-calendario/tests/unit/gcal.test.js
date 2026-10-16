import { describe, it, expect } from 'vitest';
import { toGoogle, fromGoogle, htmlToText } from '../../shared/gcal.js';
import { validateEventInput, bytesToBase32hex, isEventId } from '../../shared/model.js';

const input = {
  title: 'Dentista', owner: 'esposa', category: 'saude', kind: 'event', allDay: false,
  start: '2026-10-16T09:00', end: '2026-10-16T11:30', location: 'Centro', notes: 'Levar exames',
  reminder: '30', rrule: 'FREQ=WEEKLY',
};

describe('mapeamento Google Calendar', () => {
  it('metadados em extendedProperties.private, título limpo, fuso SP', () => {
    const g = toGoogle(input, { id: 'abcde12345', by: 'eduardo@example.com' });
    expect(g.summary).toBe('Dentista');
    expect(g.start).toEqual({ dateTime: '2026-10-16T09:00:00', timeZone: 'America/Sao_Paulo' });
    expect(g.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
    expect(g.reminders.overrides).toEqual([{ method: 'popup', minutes: 30 }]);
    expect(g.extendedProperties.private).toMatchObject({
      nc_owner: 'esposa', nc_category: 'saude', nc_kind: 'event', nc_source: 'nosso-calendario', nc_by: 'eduardo@example.com',
    });
  });
  it('ida e volta preserva o compromisso', () => {
    const g = toGoogle(input, { id: 'abcde12345' });
    const back = fromGoogle({ ...g, start: { dateTime: '2026-10-16T09:00:00-03:00' }, end: { dateTime: '2026-10-16T11:30:00-03:00' } });
    expect(back).toMatchObject({ ...input, id: 'abcde12345', source: 'google' });
  });
  it('evento criado direto no Google: responsável pela cor, padrões seguros', () => {
    const ev = fromGoogle({ id: 'x1y2z', summary: 'Mercado', colorId: '9', start: { date: '2026-10-17' }, end: { date: '2026-10-18' } });
    expect(ev).toMatchObject({ owner: 'eduardo', category: 'familia', kind: 'event', allDay: true });
  });
  it('instância de série herda a regra e o início original', () => {
    const ev = fromGoogle(
      { id: 's1_20261019T220000Z', recurringEventId: 's1', originalStartTime: { dateTime: '2026-10-19T19:00:00-03:00' },
        summary: 'Inglês', start: { dateTime: '2026-10-19T19:00:00-03:00' }, end: { dateTime: '2026-10-19T20:00:00-03:00' } },
      { s1: 'FREQ=WEEKLY' },
    );
    expect(ev).toMatchObject({ seriesId: 's1', originalStart: '2026-10-19T19:00', rrule: 'FREQ=WEEKLY' });
  });
  it('EXDATE de séries migradas, no fuso de SP', () => {
    const g = toGoogle({ ...input, exdates: ['2026-10-23T09:00'] });
    expect(g.recurrence).toEqual(['RRULE:FREQ=WEEKLY', 'EXDATE;TZID=America/Sao_Paulo:20261023T090000']);
    const d = toGoogle({ ...input, allDay: true, start: '2026-10-16', end: '2026-10-17', exdates: ['2026-10-23'] });
    expect(d.recurrence[1]).toBe('EXDATE;VALUE=DATE:20261023');
  });
  it('ignora cancelados e converte descrição HTML em texto', () => {
    expect(fromGoogle({ status: 'cancelled', id: 'a' })).toBeNull();
    expect(htmlToText('Linha<br>outra &amp; <b>mais</b>')).toBe('Linha\noutra & mais');
  });
});

describe('validação de entrada', () => {
  it('aceita entrada válida e normaliza texto', () => {
    const r = validateEventInput({ ...input, title: '  Dentista \u0007 ' });
    expect(r.ok && r.value.title).toBe('Dentista');
  });
  it('recusa responsável, categoria, datas e regra inválidas', () => {
    expect(validateEventInput({ ...input, owner: 'admin' }).ok).toBe(false);
    expect(validateEventInput({ ...input, category: 'x' }).ok).toBe(false);
    expect(validateEventInput({ ...input, end: '2026-10-16T08:00' }).ok).toBe(false);
    expect(validateEventInput({ ...input, start: '2026-02-30T09:00' }).ok).toBe(false);
    expect(validateEventInput({ ...input, rrule: 'FREQ=WEEKLY;X-EVIL=1' }).ok).toBe(false);
  });
  it('IDs base32hex aceitos pelo Google', () => {
    const id = bytesToBase32hex(new Uint8Array(16).fill(255));
    expect(isEventId(id)).toBe(true);
    expect(isEventId('ABC-123')).toBe(false);
  });
});
