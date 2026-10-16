// Feriados. Fonte principal: calendário público "Feriados no Brasil" do Google
// (atualizado pelo próprio Google). Fonte local: cálculo abaixo, usado sem
// conexão e para completar datas estaduais/municipais de Chapecó (SC).
//
// Base legal do cálculo local:
// - Nacionais: Lei 662/1949, Lei 6.802/1980 (12/10), Lei 14.759/2023 (20/11).
// - Pontos facultativos (Carnaval, Cinzas, Corpus Christi): portaria anual do
//   governo federal; em Chapecó dependem de decreto municipal.
// - SC: Data Magna, 11/08 (criação da Capitania, 1738). Lei estadual
//   18.531/2022: comemorada no domingo seguinte quando 11/08 não é domingo.
// - Chapecó: 25/08, aniversário do município (feriado municipal).

import { addDays, weekday, makeDate } from './dates.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeDate(year, month, day);
}

/** @returns {import('./types').Holiday[]} */
export function localHolidays(year) {
  const p = easter(year);
  /** @type {import('./types').Holiday[]} */
  const list = [];
  const add = (date, name, kind, scope) => list.push({ date, name, kind, scope, source: 'local' });
  const f = (m, d) => makeDate(year, m, d);
  add(f(1, 1), 'Confraternização Universal', 'feriado', 'nacional');
  add(addDays(p, -48), 'Carnaval', 'facultativo', 'nacional');
  add(addDays(p, -47), 'Carnaval', 'facultativo', 'nacional');
  add(addDays(p, -46), 'Quarta-feira de Cinzas', 'facultativo', 'nacional');
  add(addDays(p, -2), 'Sexta-feira Santa', 'feriado', 'nacional');
  add(p, 'Páscoa', 'comemorativa', 'nacional');
  add(f(4, 21), 'Tiradentes', 'feriado', 'nacional');
  add(f(5, 1), 'Dia do Trabalho', 'feriado', 'nacional');
  add(addDays(p, 60), 'Corpus Christi', 'facultativo', 'nacional');
  // SC: domingo em ou após 11/08
  const magna = f(8, 11);
  const wd = weekday(magna);
  add(wd === 0 ? magna : addDays(magna, 7 - wd), 'Data Magna de Santa Catarina', 'feriado', 'estadual');
  add(f(8, 25), 'Aniversário de Chapecó', 'feriado', 'municipal');
  add(f(9, 7), 'Independência do Brasil', 'feriado', 'nacional');
  add(f(10, 12), 'Nossa Senhora Aparecida', 'feriado', 'nacional');
  add(f(11, 2), 'Finados', 'feriado', 'nacional');
  add(f(11, 15), 'Proclamação da República', 'feriado', 'nacional');
  if (year >= 2024) add(f(11, 20), 'Dia da Consciência Negra', 'feriado', 'nacional');
  add(f(12, 25), 'Natal', 'feriado', 'nacional');
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// O Google descreve como "Feriado" datas que são ponto facultativo do serviço
// público federal (ex.: Dia do Servidor Público, Véspera de Natal após 14h).
// Para a família em Chapecó, isso não é feriado: classificamos pelo nome.
const FACULTATIVOS = /servidor p[uú]blico|v[eé]spera|cinzas|carnaval|corpus christi/i;

/**
 * Classifica um item do calendário "Feriados no Brasil" do Google.
 * Descrições reais (validado em out/2026): "Feriado" e
 * "Data comemorativa\nPara ocultar as datas comemorativas, ...".
 */
export function classifyGoogleHoliday(name, description, date, local) {
  const desc = `${description || ''}`.toLowerCase();
  if (FACULTATIVOS.test(String(name || '')) || /facultativ/.test(desc)) return 'facultativo';
  const known = local.find((h) => h.date === date && h.scope === 'nacional');
  if (/comemorativ/.test(desc)) return known ? known.kind : 'comemorativa';
  if (/feriado/.test(desc)) return 'feriado';
  if (known) return known.kind;
  return 'comemorativa';
}

/**
 * Lista final: Google quando disponível + datas locais (SC/Chapecó) que o
 * Google não traz. Sem Google: somente o cálculo local.
 * @param {number} year
 * @param {import('./types').Holiday[] | null} google
 */
export function mergeHolidays(year, google) {
  const local = localHolidays(year);
  if (!google || !google.length) return local;
  const out = [...google];
  for (const h of local) {
    if (h.scope === 'nacional') continue;
    if (!out.some((g) => g.date === h.date && g.name.toLowerCase().includes(h.name.split(' ')[0].toLowerCase()))) {
      out.push(h);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
