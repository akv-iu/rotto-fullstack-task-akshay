import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = () => process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { persistSession: false, autoRefreshToken: false };

/** Acts as the recruiter: every query is checked by RLS with their token. */
export function userClient(token: string): SupabaseClient {
  return createClient(url(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Bypasses RLS. Used only by the webhook (billing.ts) and for candidate reads after requireRecruiter (search.ts, lists.ts). */
export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createClient(url(), key, { auth: noSession });
}
