// Migração de compromissos salvos no aparelho (versões antigas do app ou o
// modo "neste aparelho") e importação de arquivos .ics/.json.
// Nada é apagado: os dados de origem ficam intactos. Cada item recebe um ID
// determinístico, então importar duas vezes (ou em dois aparelhos) não duplica.

import type { CalEvent, EventInput, Person, Category } from '../../shared/types';
import { validateEventInput, CATEGORIES, bytesToBase32hex } from '../../shared/model.js';
import { addDays, isoToWall, addMinutesWall, msToWall } from '../../shared/dates.js';
import { buildRRule } from '../../shared/recurrence.js';
import { allKeys, readRaw, KEYS } from './storage';

export interface MigrationItem {
  key: string;
  raw: unknown;
  input: EventInput;
}

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function pick(o: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    for (const k of Object.keys(o)) if (norm(k) === n) return o[k];
  }
  return undefined;
}

const TITLE = ['title', 'titulo', 'nome', 'name', 'summary', 'assunto', 'evento', 'compromisso', 'texto', 'text'];
const DATE = ['date', 'data', 'dia', 'start', 'inicio', 'startdate', 'datainicio', 'datetime', 'quando'];
const TIME_START = ['time', 'hora', 'horario', 'horainicio', 'starttime', 'inicio_hora', 'hora_inicio', 'horaini'];
const TIME_END = ['endtime', 'horafim', 'hora_fim', 'fim', 'end', 'termino', 'horatermino', 'enddate', 'datafim'];

/** Converte vários formatos de data: 'YYYY-MM-DD', 'DD/MM/YYYY', ISO, timestamp. */
export function parseLegacyDate(v: unknown): { date: string; time?: string } | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 1e11) {
    const w = msToWall(v);
    return { date: w.slice(0, 10), time: w.slice(11, 16) };
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { date: s };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { date, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined };
  }
  m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    if (m[5]) {
      const w = isoToWall(s);
      return { date: w.slice(0, 10), time: w.slice(11, 16) };
    }
    return { date: m[1], time: m[2] };
  }
  return null;
}

function parseTime(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  const m = /^(\d{1,2})[:h](\d{2})?/.exec(s);
  if (m && !/^\d{4}-/.test(s)) {
    const h = Number(m[1]);
    const mm = Number(m[2] || 0);
    if (h < 24 && mm < 60) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const d = parseLegacyDate(v);
  return d && d.time ? d.time : undefined;
}

function toOwner(v: unknown): Person {
  const s = norm(v);
  if (!s) return 'casal';
  if (s.startsWith('edu') || s === 'ele' || s === 'marido') return 'eduardo';
  if (s.startsWith('esp') || s === 'ela' || s === 'mulher') return 'esposa';
  if (s.includes('casal') || s.includes('ambos') || s.includes('nos') || s.includes('familia')) return 'casal';
  return 'casal';
}

function toCategory(v: unknown): Category {
  const s = norm(v);
  const hit = (CATEGORIES as Category[]).find((c) => s.startsWith(c.slice(0, 4)));
  if (hit) return hit;
  if (s.includes('viag')) return 'viagens';
  if (s.includes('saud') || s.includes('medic')) return 'saude';
  if (s.includes('filh') || s.includes('escola')) return 'filhos';
  return 'familia';
}

function toRRule(v: unknown): string | undefined {
  const s = norm(v);
  if (!s || s === 'nao' || s === 'none' || s === 'nunca' || s === 'false') return undefined;
  if (s.startsWith('freq=') || s.startsWith('rrule:')) return String(v).replace(/^RRULE:/i, '').toUpperCase();
  const freq = s.startsWith('diar') || s.startsWith('daily') ? 'DAILY'
    : s.startsWith('seman') || s.startsWith('weekly') ? 'WEEKLY'
    : s.startsWith('mens') || s.startsWith('monthly') ? 'MONTHLY'
    : s.startsWith('anual') || s.startsWith('yearly') ? 'YEARLY' : null;
  return freq ? buildRRule({ freq, interval: 1, byDay: [] }) : undefined;
}

/** Converte um objeto de formato desconhecido em compromisso, se possível. */
export function normalizeLegacy(o: unknown): EventInput | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const obj = o as Record<string, unknown>;
  const title = pick(obj, TITLE);
  const when = parseLegacyDate(pick(obj, DATE));
  if (typeof title !== 'string' || !title.trim() || !when) return null;
  const startTime = parseTime(pick(obj, TIME_START)) || when.time;
  const endRaw = pick(obj, TIME_END);
  let endTime = parseTime(endRaw);
  const endDate = parseLegacyDate(endRaw);
  const allDayFlag = pick(obj, ['allday', 'diainteiro', 'dia_inteiro']);
  const allDay = allDayFlag === true || !startTime;
  let start: string;
  let end: string;
  if (allDay) {
    start = when.date;
    end = endDate && endDate.date > when.date ? addDays(endDate.date, 1) : addDays(when.date, 1);
  } else {
    start = `${when.date}T${startTime}`;
    if (endDate && endDate.time && endDate.date >= when.date) end = `${endDate.date}T${endDate.time}`;
    else end = endTime && endTime > startTime! ? `${when.date}T${endTime}` : addMinutesWall(start, 60);
  }
  const typeRaw = norm(pick(obj, ['kind', 'type', 'tipo']));
  const kind = typeRaw.includes('tarefa') || typeRaw.includes('task') ? 'task' : 'event';
  const doneRaw = pick(obj, ['done', 'concluida', 'concluido', 'completed', 'feito', 'status', 'taskstatus']);
  const done = doneRaw === true || ['done', 'concluida', 'concluido', 'feito', 'completed'].includes(norm(doneRaw));
  const notes = pick(obj, ['notes', 'obs', 'observacoes', 'observacao', 'descricao', 'description', 'detalhes']);
  const v = validateEventInput({
    title: title.trim(),
    owner: toOwner(pick(obj, ['owner', 'responsavel', 'pessoa', 'quem', 'person', 'autor'])),
    category: toCategory(pick(obj, ['category', 'categoria', 'cat'])),
    kind,
    taskStatus: done ? 'done' : 'pending',
    allDay,
    start,
    end,
    location: String(pick(obj, ['location', 'local', 'lugar', 'endereco']) ?? ''),
    notes: typeof notes === 'string' ? notes : '',
    reminder: 'none',
    rrule: toRRule(pick(obj, ['rrule', 'recurrence', 'recorrencia', 'repetir', 'repeat', 'repeticao'])),
  });
  return v.ok ? (v.value as EventInput) : null;
}

function arraysIn(v: unknown): unknown[][] {
  if (Array.isArray(v)) return [v];
  if (v && typeof v === 'object') {
    const out: unknown[][] = [];
    for (const val of Object.values(v as Record<string, unknown>)) {
      if (Array.isArray(val)) out.push(val);
      else if (val && typeof val === 'object') {
        // { '2026-10-16': [...] } — eventos agrupados por dia
        const inner = Object.values(val as Record<string, unknown>).filter(Array.isArray) as unknown[][];
        out.push(...inner);
      }
    }
    return out;
  }
  return [];
}

/** Procura compromissos em todas as chaves do localStorage desta origem. */
export function detectLegacy(): MigrationItem[] {
  const items: MigrationItem[] = [];
  for (const key of allKeys()) {
    if (key.startsWith('nc:') && key !== KEYS.local) continue;
    const raw = readRaw(key);
    if (!raw || raw.length > 3_000_000 || !/^[[{]/.test(raw.trim())) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (key === KEYS.local) {
      for (const ev of parsed as CalEvent[]) {
        const v = validateEventInput(ev);
        if (v.ok) items.push({ key, raw: ev, input: v.value as EventInput });
      }
      continue;
    }
    for (const arr of arraysIn(parsed)) {
      for (const o of arr) {
        const input = normalizeLegacy(o);
        if (input) items.push({ key, raw: o, input });
      }
    }
  }
  return items;
}

/** Hash estável → ID base32hex aceito pelo Google (prefixo 'm' = migração). */
export async function stableId(text: string): Promise<string> {
  try {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return 'm' + bytesToBase32hex(new Uint8Array(buf)).slice(0, 25);
    }
  } catch {
    /* sem SubtleCrypto (http fora de localhost): usa FNV abaixo */
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ text.charCodeAt(text.length - 1 - i), 2246822519) >>> 0;
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint32(0, h1);
  new DataView(bytes.buffer).setUint32(4, h2);
  return 'm' + bytesToBase32hex(bytes);
}

// ---------- Importação de arquivo ----------

function unfold(ics: string) {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}
function icsValue(v: string) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function icsDate(params: string, value: string): { date: string; time?: string } | null {
  if (/VALUE=DATE(;|$)/.test(params) || /^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  if (m[7] === 'Z') {
    const w = isoToWall(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    return { date: w.slice(0, 10), time: w.slice(11, 16) };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** Lê VEVENTs de um arquivo .ics (exportado do Google, Apple, Outlook). */
export function parseICS(text: string): EventInput[] {
  const out: EventInput[] = [];
  let cur: Record<string, { params: string; value: string }> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const s = cur.DTSTART && icsDate(cur.DTSTART.params, cur.DTSTART.value);
      const e = cur.DTEND && icsDate(cur.DTEND.params, cur.DTEND.value);
      if (s && cur.SUMMARY) {
        const allDay = !s.time;
        const start = allDay ? s.date : `${s.date}T${s.time}`;
        const end = allDay ? (e ? e.date : addDays(s.date, 1)) : e && e.time ? `${e.date}T${e.time}` : addMinutesWall(start, 60);
        const rr = cur.RRULE ? cur.RRULE.value.replace(/;?(BYMONTHDAY|BYSETPOS|BYMONTH|BYHOUR|BYMINUTE)=[^;]*/g, '') : undefined;
        const v = validateEventInput({
          title: icsValue(cur.SUMMARY.value), owner: 'casal', category: 'familia', kind: 'event',
          allDay, start, end, location: cur.LOCATION ? icsValue(cur.LOCATION.value) : '',
          notes: cur.DESCRIPTION ? icsValue(cur.DESCRIPTION.value) : '', reminder: 'none', rrule: rr,
        });
        if (v.ok) out.push(v.value as EventInput);
        else if (rr) {
          const v2 = validateEventInput({ title: icsValue(cur.SUMMARY.value), owner: 'casal', category: 'familia', kind: 'event', allDay, start, end, location: '', notes: '', reminder: 'none' });
          if (v2.ok) out.push(v2.value as EventInput);
        }
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) {
        const head = line.slice(0, i);
        const [name, ...params] = head.split(';');
        cur[name.toUpperCase()] = { params: params.join(';'), value: line.slice(i + 1) };
      }
    }
  }
  return out;
}

/** .ics ou .json (backup deste app ou formato antigo). */
export function parseImportFile(name: string, text: string): EventInput[] {
  if (/\.ics$/i.test(name) || text.includes('BEGIN:VCALENDAR')) return parseICS(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const out: EventInput[] = [];
  for (const arr of arraysIn(parsed)) {
    for (const o of arr) {
      const v = validateEventInput(o);
      if (v.ok) out.push(v.value as EventInput);
      else {
        const n = normalizeLegacy(o);
        if (n) out.push(n);
      }
    }
  }
  return out;
}
