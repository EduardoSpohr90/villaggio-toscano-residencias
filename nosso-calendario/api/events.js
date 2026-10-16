// @ts-check
// /api/events
//   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD        lista (recorrências expandidas)
//   POST   { event, id?, migrationId? }          cria (idempotente pelo id)
//   PATCH  ?id=...&scope=this|following|all      { event, seriesId?, originalStart?, newId? }
//   DELETE ?id=...&scope=this|following|all[&seriesId&originalStart]
import { getConfig } from './_lib/config.js';
import {
  assertMutationAllowed, handler, HttpError, methodNotAllowed, readJson, requestUrl, sendJson,
} from './_lib/http.js';
import { requireAuth } from './_lib/google.js';
import { resolveCalendar, listEvents, createEvent, updateEvent, deleteEvent } from './_lib/calendar.js';
import { validateEventInput, isAnyEventId, isDate, isDateTime, isEventId } from '../shared/model.js';
import { diffDays } from '../shared/dates.js';

const SCOPES = ['this', 'following', 'all'];

function parseScope(v) {
  return SCOPES.includes(String(v)) ? /** @type {'this'|'following'|'all'} */ (v) : 'this';
}
function hintsFrom(src) {
  return {
    seriesId: isEventId(src.seriesId) ? src.seriesId : undefined,
    originalStart: isDate(src.originalStart) || isDateTime(src.originalStart) ? src.originalStart : undefined,
    newId: isEventId(src.newId) ? src.newId : undefined,
  };
}

export default handler(async (req, res) => {
  const cfg = getConfig();
  if (req.method !== 'GET') assertMutationAllowed(req, cfg);
  const ctx = await requireAuth(req, res, cfg);
  const cal = await resolveCalendar(ctx);
  const q = requestUrl(req).searchParams;

  if (req.method === 'GET') {
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (!isDate(from) || !isDate(to) || to <= from || diffDays(from, to) > 800) {
      throw new HttpError(400, 'range', 'Intervalo de datas inválido.');
    }
    const events = await listEvents(ctx, cal.id, from, to);
    return sendJson(res, 200, { events, calendar: cal, fetchedAt: new Date().toISOString() });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const v = validateEventInput(body.event);
    if (!v.ok) throw new HttpError(400, 'invalid', v.error);
    const migrationId = typeof body.migrationId === 'string' ? body.migrationId.slice(0, 64) : undefined;
    const out = await createEvent(ctx, cal.id, v.value, { id: body.id, migrationId });
    return sendJson(res, out.duplicate ? 200 : 201, out);
  }

  const id = q.get('id') || '';
  if (!isAnyEventId(id)) throw new HttpError(400, 'id', 'Compromisso inválido.');
  const scope = parseScope(q.get('scope'));

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const v = validateEventInput(body.event);
    if (!v.ok) throw new HttpError(400, 'invalid', v.error);
    const out = await updateEvent(ctx, cal.id, id, v.value, scope, hintsFrom(body));
    return sendJson(res, 200, out);
  }

  if (req.method === 'DELETE') {
    const out = await deleteEvent(ctx, cal.id, id, scope, hintsFrom(Object.fromEntries(q.entries())));
    return sendJson(res, 200, out);
  }

  throw methodNotAllowed();
});
