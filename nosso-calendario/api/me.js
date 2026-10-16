// @ts-check
// GET /api/me → estado da conexão (sem expor tokens).
import { getConfig, isConfigured } from './_lib/config.js';
import { handler, sendJson, HttpError } from './_lib/http.js';
import { requireAuth } from './_lib/google.js';
import { resolveCalendar } from './_lib/calendar.js';

export default handler(async (req, res) => {
  const cfg = getConfig();
  if (!isConfigured(cfg)) return sendJson(res, 200, { configured: false, authenticated: false, labels: cfg.labels });
  let ctx;
  try {
    ctx = await requireAuth(req, res, cfg);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      return sendJson(res, 200, { configured: true, authenticated: false, reason: e.code, labels: cfg.labels });
    }
    throw e;
  }
  const calendar = await resolveCalendar(ctx, { required: false });
  sendJson(res, 200, {
    configured: true,
    authenticated: true,
    email: ctx.session.email,
    name: ctx.session.name,
    person: ctx.session.person,
    labels: cfg.labels,
    calendar,
    calendarName: cfg.calendarName,
    busyEnabled: cfg.busySources.length > 0,
  });
});
