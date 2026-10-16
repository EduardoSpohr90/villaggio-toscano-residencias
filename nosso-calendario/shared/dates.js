// Datas em America/Sao_Paulo, independentes do fuso do aparelho.
//
// Regras para evitar os erros clássicos de UTC:
// - 'YYYY-MM-DD' nunca passa por new Date('YYYY-MM-DD') (isso é meia-noite UTC,
//   que em São Paulo é o dia anterior). A aritmética de dias usa Date.UTC.
// - Horários são "hora de parede" de São Paulo ('YYYY-MM-DDTHH:MM'). A conversão
//   para instante absoluto consulta o fuso via Intl, o que cobre o horário de
//   verão histórico (até 2019) sem tabela própria.

import { TZ } from './model.js';

const pad = (n) => String(n).padStart(2, '0');

/** @type {Intl.DateTimeFormat | null} */
let partsFmt = null;
function fmt() {
  if (!partsFmt) {
    partsFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }
  return partsFmt;
}

/** Partes de data/hora em São Paulo para um instante (ms). */
export function zonedParts(ms) {
  const parts = {};
  for (const p of fmt().formatToParts(new Date(ms))) parts[p.type] = p.value;
  // Alguns motores antigos devolvem "24" para meia-noite.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Diferença (ms) entre a hora de parede de SP e UTC no instante dado. */
export function tzOffsetMs(ms) {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** 'YYYY-MM-DDTHH:MM' (hora de SP) → instante em ms. */
export function wallToMs(wall) {
  const [d, t = '00:00'] = wall.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  let ms = guess - tzOffsetMs(guess);
  // Segunda passada resolve o instante próximo de mudança de horário.
  const off2 = tzOffsetMs(ms);
  ms = guess - off2;
  return ms;
}

/** Instante (ms) → 'YYYY-MM-DDTHH:MM' em SP. */
export function msToWall(ms) {
  const p = zonedParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO com offset (ex.: do Google) → hora de parede em SP. */
export function isoToWall(iso) {
  return msToWall(Date.parse(iso));
}

/** Hora de parede SP → ISO UTC 'YYYYMMDDTHHMMSSZ' (formato UNTIL / ID de instância). */
export function wallToCompactUtc(wall) {
  const d = new Date(wallToMs(wall));
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Hoje em SP: 'YYYY-MM-DD'. */
export function today(now = Date.now()) {
  return msToWall(now).slice(0, 10);
}
/** Agora em SP: 'YYYY-MM-DDTHH:MM'. */
export function nowWall(now = Date.now()) {
  return msToWall(now);
}

function parseDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}
function fromUtc(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date, n) {
  return fromUtc(parseDate(date) + n * 86400000);
}
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
/** 0 = domingo ... 6 = sábado */
export function weekday(date) {
  return new Date(parseDate(date)).getUTCDay();
}
/** Semana começa na segunda-feira (planejamento do fim de semana junto). */
export function startOfWeek(date) {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}
export function startOfMonth(date) {
  return date.slice(0, 8) + '01';
}
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}
export function makeDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Minutos desde 00:00 de uma hora 'HH:MM'. */
export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function minToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
/** Soma minutos a uma hora de parede, atravessando dias. */
export function addMinutesWall(wall, minutes) {
  const [d, t] = wall.split('T');
  const total = timeToMin(t) + minutes;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(d, dayShift)}T${minToTime(total)}`;
}
/** Minutos entre duas horas de parede (mesma régua de SP). */
export function diffMinutesWall(a, b) {
  const [da, ta] = a.split('T');
  const [db, tb] = b.split('T');
  return diffDays(da, db) * 1440 + timeToMin(tb) - timeToMin(ta);
}

/**
 * Intervalo absoluto [ms, ms) de um evento, para conflitos e ordenação.
 * Dia inteiro: do início do primeiro dia ao início do dia final (exclusivo).
 */
export function eventRangeMs(ev) {
  if (ev.allDay) return [wallToMs(ev.start + 'T00:00'), wallToMs(ev.end + 'T00:00')];
  return [wallToMs(ev.start), wallToMs(ev.end)];
}

/** Datas (YYYY-MM-DD) que o evento ocupa. */
export function eventDays(ev) {
  const first = ev.start.slice(0, 10);
  let last;
  if (ev.allDay) last = addDays(ev.end, -1);
  else {
    last = ev.end.slice(0, 10);
    // Termina exatamente à meia-noite: não ocupa o dia seguinte.
    if (ev.end.slice(11) === '00:00' && last > first) last = addDays(last, -1);
  }
  const out = [];
  for (let d = first; d <= last && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- Formatação pt-BR ----------
export const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** Cabeçalho do mês com semana começando na segunda. */
export const WEEK_HEADER = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/** '16 de outubro' */
export function formatDayMonth(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]}`;
}
/** 'sex, 16 out' */
export function formatShort(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS_SHORT[weekday(date)]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}
/** 'Sexta, 16 de outubro' */
export function formatLong(date) {
  return `${capitalize(WEEKDAYS[weekday(date)])}, ${formatDayMonth(date)}`;
}
/** 'HH:MM' de uma hora de parede */
export function timeOf(wall) {
  return wall.slice(11, 16);
}
/** Faixa legível de um evento: 'Dia inteiro' | '09:00–11:30' */
export function formatRange(ev) {
  if (ev.allDay) {
    const days = diffDays(ev.start, ev.end);
    if (days <= 1) return 'Dia inteiro';
    return `${formatShort(ev.start)} – ${formatShort(addDays(ev.end, -1))}`;
  }
  const sameDay = ev.start.slice(0, 10) === ev.end.slice(0, 10);
  if (sameDay) return `${timeOf(ev.start)}–${timeOf(ev.end)}`;
  return `${timeOf(ev.start)} – ${formatShort(ev.end.slice(0, 10))} ${timeOf(ev.end)}`;
}
