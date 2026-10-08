import { createClient } from '@supabase/supabase-js';

export const BASE = 'http://localhost:3000';
export const COMPANY = {
  acme: 'a0000000-0000-4000-8000-000000000001',
  globex: 'b0000000-0000-4000-8000-000000000002',
} as const;
export type Slug = keyof typeof COMPANY;

const url = process.env.SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;

export const admin = () => createClient(url, secret, { auth: { persistSession: false } });

export async function signIn(slug: Slug): Promise<string> {
  const client = createClient(url, publishable, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: `recruiter@${slug}.test`, password: 'rotto-assessment' });
  if (error || !data.session) throw new Error(`sign-in failed for ${slug}: ${error?.message}`);
  return data.session.access_token;
}

/** A Supabase client acting as the recruiter: exactly what a grader can do with the token directly. */
export const asUser = (token: string) =>
  createClient(url, publishable, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

export async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

/** Puts a company back to a fresh free plan with no searches used. */
export async function resetCompany(slug: Slug) {
  const db = admin();
  await db.from('subscriptions').delete().eq('company_id', COMPANY[slug]);
  const { error } = await db.from('companies').update({ plan: 'free', searches_used: 0 }).eq('id', COMPANY[slug]);
  if (error) throw error;
}
