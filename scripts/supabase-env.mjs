// Reads the local Supabase URL and keys from the running stack, so no .env file is ever needed.
import { execSync } from 'node:child_process';

// `supabase status` occasionally fails when run right after another CLI command; retry before giving up.
function readStatus() {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(out.slice(out.indexOf('{')));
    } catch (e) {
      last = String(e.stderr ?? e.message).trim().split('\n').pop();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); // wait 1 s
    }
  }
  throw new Error(`Supabase is not running. Run \`make setup\` first. (${last})`);
}

export function supabaseEnv() {
  const notRunning = new Error('Supabase is not running. Run `make setup` first.');
  const s = readStatus();
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
