// @ts-check
// GET /api/holidays?year=2026 → calendário público "Feriados no Brasil".
import { getConfig } from './_lib/config.js';
import { handler, HttpError, requestUrl, sendJson } from './_lib/http.js';
import { requireAuth } from './_lib/google.js';
import { listHolidays } from './_lib/calendar.js';

export default handler(async (req, res) => {
  const cfg = getConfig();
  const ctx = await requireAuth(req, res, cfg);
  const year = Number(requestUrl(req).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'year', 'Ano inválido.');
  const holidays = await listHolidays(ctx, year);
  sendJson(res, 200, { year, holidays });
});
