import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { createSaved, listSaved } from '@/lib/server/lists';

export const GET = route(async (req) => json(await listSaved(await requireRecruiter(req))));

export const POST = route(async (req) => {
  const ctx = await requireRecruiter(req);
  return json(await createSaved(ctx, await readJson(req)));
});
