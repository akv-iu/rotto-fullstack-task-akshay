import { requireRecruiter } from '@/lib/server/auth';
import { HttpError, json, readJson, route } from '@/lib/server/http';
import { correctSearch, newSearch, rerunSaved } from '@/lib/server/search';

// Contract: { brief }. Extensions (TECH §3a): { parent_search_id, filters } = correction; { saved_brief_id } = re-run.
// Exactly one mode; any other mix of these four fields is a 400 (SPEC FR-2.8).
const MODE_FIELDS = ['brief', 'filters', 'parent_search_id', 'saved_brief_id'];

export const POST = route(async (req) => {
  const ctx = await requireRecruiter(req);
  const body = await readJson(req);
  const mode = MODE_FIELDS.filter((k) => k in body).join(',');
  if (mode === 'brief' && typeof body.brief === 'string') return json(await newSearch(ctx, body.brief));
  if (mode === 'filters,parent_search_id' && typeof body.parent_search_id === 'string') return json(await correctSearch(ctx, body.parent_search_id, body.filters));
  if (mode === 'saved_brief_id' && typeof body.saved_brief_id === 'string') return json(await rerunSaved(ctx, body.saved_brief_id));
  throw new HttpError(400, 'Send { "brief": "..." } to search.');
});
