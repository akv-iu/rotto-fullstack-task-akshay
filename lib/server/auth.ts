import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http';
import { userClient } from './supabase';

export type Ctx = { db: SupabaseClient; companyId: string };

/** The company comes only from the token: PostgREST verifies the JWT, the DB maps the user to a company. */
export function requestClient(req: Request): SupabaseClient {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!match) throw new HttpError(401, 'Sign in to continue.');
  return userClient(match[1]);
}

export async function requireRecruiter(req: Request): Promise<Ctx> {
  const db = requestClient(req);
  const { data, error } = await db.rpc('current_company_id');
  if (error || !data) throw new HttpError(401, 'Sign in to continue.');
  return { db, companyId: data as string };
}
