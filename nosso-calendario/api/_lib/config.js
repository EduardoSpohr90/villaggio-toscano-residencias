// @ts-check
// Configuração do servidor, lida somente de variáveis de ambiente.
// Nenhum segredo chega ao navegador: o cliente só conhece /api/*.

import { createHash, hkdfSync } from 'node:crypto';
import { DEFAULT_PERSON_LABELS, PEOPLE } from '../../shared/model.js';

export const SCOPES = [
  'openid',
  'email',
  'profile',
  // Escopo completo do Calendar: necessário para criar o calendário da
  // família, compartilhá-lo (ACL), ler/gravar eventos e consultar
  // disponibilidade (free/busy). Ver README > Segurança.
  'https://www.googleapis.com/auth/calendar',
];

export const HOLIDAY_CALENDAR_ID = 'pt.brazilian#holiday@group.v.calendar.google.com';

/**
 * ALLOWED_USERS="eduardo:email1@gmail.com,esposa:email2@gmail.com"
 * @returns {Map<string, import('../../shared/types').Person>}
 */
export function parseAllowedUsers(raw) {
  const map = new Map();
  for (const item of String(raw || '').split(/[,;\s]+/)) {
    const [person, email] = item.split(':');
    if (!email || !PEOPLE.includes(/** @type {any} */ (person))) continue;
    if (person === 'casal') continue;
    map.set(email.trim().toLowerCase(), /** @type {any} */ (person));
  }
  return map;
}

/** PERSON_LABELS="eduardo:Eduardo,esposa:Ana,casal:Casal" */
export function parseLabels(raw) {
  const labels = { ...DEFAULT_PERSON_LABELS };
  for (const item of String(raw || '').split(',')) {
    const [p, label] = item.split(':');
    if (label && PEOPLE.includes(/** @type {any} */ (p))) labels[p] = label.trim().slice(0, 24);
  }
  return labels;
}

/**
 * BUSY_SOURCES="eduardo:agenda.pessoal@gmail.com|trabalho@empresa.com,esposa:outra@gmail.com"
 * Agendas individuais consultadas apenas como "Ocupado" (free/busy).
 * @returns {{ person: string, calendar: string }[]}
 */
export function parseBusySources(raw) {
  const out = [];
  for (const item of String(raw || '').split(',')) {
    const [p, cals] = item.split(':');
    if (!cals || p === 'casal' || !PEOPLE.includes(/** @type {any} */ (p))) continue;
    for (const c of cals.split('|')) if (c.trim()) out.push({ person: p.trim(), calendar: c.trim() });
  }
  return out;
}

export function getConfig(env = process.env) {
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  // Chave da sessão: SESSION_SECRET (recomendado) ou derivada do client
  // secret com HKDF — assim não há segredo extra para copiar à mão.
  let sessionKey = null;
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) {
    sessionKey = createHash('sha256').update(env.SESSION_SECRET).digest();
  } else if (clientSecret) {
    sessionKey = Buffer.from(hkdfSync('sha256', clientSecret, 'nosso-calendario', 'session-v1', 32));
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret,
    sessionKey,
    allowedUsers: parseAllowedUsers(env.ALLOWED_USERS),
    calendarId: env.FAMILY_CALENDAR_ID || '',
    calendarName: env.FAMILY_CALENDAR_NAME || 'Família Spohr',
    labels: parseLabels(env.PERSON_LABELS),
    busySources: parseBusySources(env.BUSY_SOURCES),
    appUrl: (env.APP_URL || '').replace(/\/$/, ''),
    authUrl: env.GOOGLE_OAUTH_AUTHORIZE_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    apiBase: (env.GOOGLE_CALENDAR_API_BASE || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, ''),
  };
}

/** @param {ReturnType<typeof getConfig>} cfg */
export function isConfigured(cfg) {
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.sessionKey && cfg.allowedUsers.size);
}
