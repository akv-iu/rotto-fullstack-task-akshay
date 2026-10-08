// Reads the local Supabase URL and keys from the running stack, so no .env file is ever needed.
import { execSync } from 'node:child_process';

export function supabaseEnv() {
  const notRunning = new Error('Supabase is not running. Run `make setup` first.');
  let s;
  try {
    const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    s = JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    throw notRunning;
  }
  const url = s.API_URL;
  // Prefer the JWT keys (accepted by every Supabase API, including the auth admin API); fall back to the new key names.
  const publishable = s.ANON_KEY ?? s.PUBLISHABLE_KEY;
  const secret = s.SERVICE_ROLE_KEY ?? s.SECRET_KEY;
  if (!url || !publishable || !secret) throw notRunning;
  return {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: secret,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  };
}
