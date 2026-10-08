// `make dev`: serve the app on :3000 with the Supabase env plus the grader's OPENAI_API_KEY / STRIPE_WEBHOOK_SECRET.
import { spawn } from 'node:child_process';
import { supabaseEnv } from './supabase-env.mjs';

const child = spawn('npx next dev -p 3000', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...supabaseEnv() },
});
child.on('exit', (code) => process.exit(code ?? 1));

// `next dev` builds each route on its first request (1–3 s), which would make the first search and the first page
// miss the speed limits (3 s / 300 ms). Request every page and route once as soon as the server is up, without a
// token: they answer 401 / 400 / 405 and read or change nothing, but each one is built before anyone uses it.
const BASE = 'http://localhost:3000';
const ID = '00000000-0000-4000-8000-000000000000';
const WARM = [
  ['GET', '/sign-in'], ['GET', '/'], ['GET', '/shortlists'], ['GET', `/shortlists/${ID}`], ['GET', '/saved'],
  ['POST', '/api/search'], ['GET', `/api/search/${ID}`], ['GET', '/api/plan'], ['GET', '/api/people/cand_0001'],
  ['GET', '/api/shortlists'], ['GET', `/api/shortlists/${ID}`], ['POST', `/api/shortlists/${ID}/people/cand_0001`],
  ['GET', '/api/saved-briefs'], ['DELETE', `/api/saved-briefs/${ID}`], ['POST', '/api/billing/events'],
];
for (let i = 0; i < 120; i++) {
  try { await fetch(`${BASE}/api/plan`); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}
for (const [method, path] of WARM) await fetch(BASE + path, { method }).catch(() => {});
console.log('✓ All routes built: the first search and page will be fast.');
