// Modelo de dados do Nosso Calendário. Compartilhado entre o app (navegador)
// e as Vercel Functions: as mesmas regras validam o formulário e a API.

export const TZ = 'America/Sao_Paulo';

/** @typedef {'eduardo'|'esposa'|'casal'} Person */
/** @typedef {'familia'|'trabalho'|'filhos'|'viagens'|'saude'|'lazer'|'casa'|'pessoal'} Category */
/** @typedef {'event'|'task'} Kind */
/** @typedef {'pending'|'done'} TaskStatus */
/** @typedef {'none'|'0'|'10'|'30'|'60'|'1440'} Reminder */

/** @type {Person[]} */
export const PEOPLE = ['eduardo', 'esposa', 'casal'];

/** @type {Record<Person, string>} */
export const DEFAULT_PERSON_LABELS = { eduardo: 'Eduardo', esposa: 'Esposa', casal: 'Casal' };

/** @type {Category[]} */
export const CATEGORIES = ['familia', 'trabalho', 'filhos', 'viagens', 'saude', 'lazer', 'casa', 'pessoal'];

/** @type {Record<Category, string>} */
export const CATEGORY_LABELS = {
  familia: 'Família',
  trabalho: 'Trabalho',
  filhos: 'Filhos',
  viagens: 'Viagens',
  saude: 'Saúde',
  lazer: 'Lazer',
  casa: 'Casa',
  pessoal: 'Pessoal',
};

/** @type {Reminder[]} */
export const REMINDERS = ['none', '0', '10', '30', '60', '1440'];

/** @type {Record<Reminder, string>} */
export const REMINDER_LABELS = {
  none: 'Nenhum',
  '0': 'No horário',
  '10': '10 min antes',
  '30': '30 min antes',
  '60': '1 hora antes',
  '1440': '1 dia antes',
};

export const LIMITS = { title: 200, location: 300, notes: 4000 };

// Cor do evento no Google Calendar = responsável. Assim a camada "pessoa"
// também aparece no app oficial do Google e é lida de volta quando alguém
// cria um evento direto por lá.
/** @type {Record<Person, string>} */
export const GOOGLE_COLOR_BY_PERSON = { eduardo: '9', esposa: '4', casal: '2' };
export const GOOGLE_COLOR_TASK_DONE = '8';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
// Recorrência aceita: subconjunto seguro da RFC 5545 que o app sabe gerar.
const RRULE_RE =
  /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;(INTERVAL=\d{1,3}|COUNT=\d{1,4}|UNTIL=\d{8}(T\d{6}Z)?|BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6}|WKST=(MO|SU)))*$/;

export function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) && isRealDate(v);
}
export function isDateTime(v) {
  if (typeof v !== 'string' || !DATETIME_RE.test(v)) return false;
  const [d, t] = v.split('T');
  const [hh, mm] = t.split(':').map(Number);
  return isRealDate(d) && hh < 24 && mm < 60;
}
function isRealDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}
export function isRRule(v) {
  return typeof v === 'string' && v.length <= 200 && RRULE_RE.test(v);
}

/** Remove caracteres de controle e corta no limite. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

/**
 * Valida e normaliza a entrada de um compromisso vinda do cliente.
 * Nunca confia em campos derivados de identidade (createdBy etc.): esses
 * são definidos pelo servidor a partir da sessão.
 * @param {any} input
 * @returns {{ ok: true, value: import('./types').EventInput } | { ok: false, error: string }}
 */
export function validateEventInput(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Dados inválidos.' };
  const title = cleanText(input.title, LIMITS.title);
  if (!title) return { ok: false, error: 'Informe um título.' };
  const owner = PEOPLE.includes(input.owner) ? input.owner : null;
  if (!owner) return { ok: false, error: 'Responsável inválido.' };
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) return { ok: false, error: 'Categoria inválida.' };
  const kind = input.kind === 'task' ? 'task' : input.kind === 'event' ? 'event' : null;
  if (!kind) return { ok: false, error: 'Tipo inválido.' };
  const taskStatus = kind === 'task' ? (input.taskStatus === 'done' ? 'done' : 'pending') : undefined;
  const allDay = input.allDay === true;
  const start = input.start;
  const end = input.end;
  if (allDay) {
    if (!isDate(start) || !isDate(end)) return { ok: false, error: 'Data inválida.' };
    if (end <= start) return { ok: false, error: 'A data final precisa ser depois da inicial.' };
  } else {
    if (!isDateTime(start) || !isDateTime(end)) return { ok: false, error: 'Horário inválido.' };
    if (end <= start) return { ok: false, error: 'O término precisa ser depois do início.' };
  }
  const reminder = REMINDERS.includes(input.reminder) ? input.reminder : 'none';
  const rrule = input.rrule ? String(input.rrule) : '';
  if (rrule && !isRRule(rrule)) return { ok: false, error: 'Recorrência inválida.' };
  // Datas excluídas da série (usadas na migração de séries locais).
  let exdates;
  if (rrule && Array.isArray(input.exdates) && input.exdates.length) {
    const okFmt = allDay ? isDate : isDateTime;
    exdates = input.exdates.filter(okFmt).slice(0, 366);
  }
  return {
    ok: true,
    value: {
      title,
      owner,
      category,
      kind,
      taskStatus,
      allDay,
      start,
      end,
      location: cleanText(input.location, LIMITS.location),
      notes: cleanText(input.notes, LIMITS.notes),
      reminder,
      rrule: rrule || undefined,
      exdates,
    },
  };
}

// IDs de evento aceitos pelo Google Calendar: base32hex (a-v, 0-9), 5 a 1024.
// Gerar o ID no cliente torna a criação idempotente: repetir o envio
// (fila offline, migração) devolve 409 em vez de duplicar o evento.
export const EVENT_ID_RE = /^[a-v0-9]{5,1024}$/;
// IDs existentes (criados no Google, importados de .ics, instâncias de série
// <id>_<data>[T<hora>Z]) podem ter outros caracteres seguros.
export const INSTANCE_ID_RE = /^[A-Za-z0-9_-]{1,1100}$/;

export function isEventId(v) {
  return typeof v === 'string' && EVENT_ID_RE.test(v);
}
export function isAnyEventId(v) {
  return typeof v === 'string' && v.length <= 1100 && INSTANCE_ID_RE.test(v);
}

const B32 = '0123456789abcdefghijklmnopqrstuv';
/** Converte bytes em base32hex minúsculo (alfabeto aceito pelo Google). */
export function bytesToBase32hex(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
