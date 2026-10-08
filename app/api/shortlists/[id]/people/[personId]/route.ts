import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { addMember, removeMember } from '@/lib/server/lists';

type P = { id: string; personId: string };

export const POST = route<P>(async (req, { params }) => {
  const { id, personId } = await params;
  return json(await addMember(await requireRecruiter(req), id, personId));
});

export const DELETE = route<P>(async (req, { params }) => {
  const { id, personId } = await params;
  return json(await removeMember(await requireRecruiter(req), id, personId));
});
