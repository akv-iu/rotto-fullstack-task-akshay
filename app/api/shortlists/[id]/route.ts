import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { deleteShortlist, getShortlist, renameShortlist } from '@/lib/server/lists';

type P = { id: string };

export const GET = route<P>(async (req, { params }) => json(await getShortlist(await requireRecruiter(req), (await params).id)));

export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await requireRecruiter(req);
  return json(await renameShortlist(ctx, (await params).id, (await readJson(req)).name));
});

export const DELETE = route<P>(async (req, { params }) => json(await deleteShortlist(await requireRecruiter(req), (await params).id)));
