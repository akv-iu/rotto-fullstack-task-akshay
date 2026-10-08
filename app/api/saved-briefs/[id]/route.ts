import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { deleteSaved } from '@/lib/server/lists';

export const DELETE = route<{ id: string }>(async (req, { params }) =>
  json(await deleteSaved(await requireRecruiter(req), (await params).id)));
