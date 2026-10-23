import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Every data call goes through our /api with the session token (ARCHITECTURE rule 1). */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Sign in to continue.');
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "We couldn't reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) await supabase.auth.signOut(); // expired session: the layout guard sends them to sign-in
  if (!res.ok) {
    const message = typeof json?.error === 'string' ? json.error.trim() : '';
    // Keep our actionable server messages, but don't show a proxy/framework's raw error to the recruiter.
    const generic = !message || /^(internal server error|bad gateway|service unavailable|gateway timeout)\.?$/i.test(message);
    throw new ApiError(res.status, generic ? 'Something went wrong. Please try again in a moment.' : message);
  }
  return json as T;
}
