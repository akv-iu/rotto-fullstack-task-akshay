import { supabase } from './supabase';

let pending: ReturnType<typeof supabase.auth.signInAnonymously> | null = null;

// StrictMode and simultaneous mounts must share one anonymous sign-in, rather than creating extra visitors.
export async function startDemoSession() {
  const request = pending ??= supabase.auth.signInAnonymously();
  try {
    const { data, error } = await request;
    if (error || !data.session) throw new Error("We couldn't start the demo. Please try again.");
    return data.session;
  } finally {
    if (pending === request) pending = null;
  }
}
