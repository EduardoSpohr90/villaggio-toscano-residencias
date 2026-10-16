// @ts-check
// GET /api/freebusy?from&to → agendas individuais apenas como "Ocupado".
import { getConfig } from './_lib/config.js';
import { handler, HttpError, requestUrl, sendJson } from './_lib/http.js';
import { requireAuth } from './_lib/google.js';
import { freeBusy } from './_lib/calendar.js';
import { isDate } from '../shared/model.js';
import { diffDays } from '../shared/dates.js';

export default handler(async (req, res) => {
  const cfg = getConfig();
  const ctx = await requireAuth(req, res, cfg);
  const q = requestUrl(req).searchParams;
  const from = q.get('from') || '';
  const to = q.get('to') || '';
  if (!isDate(from) || !isDate(to) || to <= from || diffDays(from, to) > 120) {
    throw new HttpError(400, 'range', 'Intervalo de datas inválido.');
  }
  sendJson(res, 200, await freeBusy(ctx, from, to));
});
