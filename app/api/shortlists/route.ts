import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { createShortlist, listShortlists } from '@/lib/server/lists';

export const GET = route(async (req) => json(await listShortlists(await requireRecruiter(req))));

export const POST = route(async (req) => {
  const ctx = await requireRecruiter(req);
  return json(await createShortlist(ctx, (await readJson(req)).name));
});
