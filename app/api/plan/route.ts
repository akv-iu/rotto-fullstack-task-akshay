import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { getPlan } from '@/lib/server/search';

export const GET = route(async (req) => json(await getPlan(await requireRecruiter(req))));
