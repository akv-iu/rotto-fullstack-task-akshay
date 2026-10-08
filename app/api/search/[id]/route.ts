import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { getPage } from '@/lib/server/search';

export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireRecruiter(req);
  const { id } = await params;
  return json(await getPage(ctx, id, new URL(req.url).searchParams.get('page')));
});
