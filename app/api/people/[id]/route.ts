import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { getPerson } from '@/lib/server/lists';

export const GET = route<{ id: string }>(async (req, { params }) =>
  json(await getPerson(await requireRecruiter(req), (await params).id)));
