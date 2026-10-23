import { requestClient } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { getPage } from '@/lib/server/search';

export const GET = route<{ id: string }>(async (req, { params }) => {
  const db = requestClient(req);
  const { id } = await params;
  return json(await getPage(db, id, new URL(req.url).searchParams.get('page')));
});
