// @ts-check
// POST /api/setup → cria o calendário da família (se ainda não existe) e
// compartilha com as demais pessoas de ALLOWED_USERS.
import { getConfig } from './_lib/config.js';
import { assertMutationAllowed, handler, methodNotAllowed, sendJson } from './_lib/http.js';
import { requireAuth } from './_lib/google.js';
import { setupCalendar } from './_lib/calendar.js';

export default handler(async (req, res) => {
  if (req.method !== 'POST') throw methodNotAllowed();
  const cfg = getConfig();
  assertMutationAllowed(req, cfg);
  const ctx = await requireAuth(req, res, cfg);
  sendJson(res, 200, await setupCalendar(ctx));
});
