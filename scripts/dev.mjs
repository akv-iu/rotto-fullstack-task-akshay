// `make dev`: serve the app on :3000 with the Supabase env plus the grader's OPENAI_API_KEY / STRIPE_WEBHOOK_SECRET.
import { spawn } from 'node:child_process';
import { supabaseEnv } from './supabase-env.mjs';

const child = spawn('npx next dev -p 3000', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...supabaseEnv() },
});
child.on('exit', (code) => process.exit(code ?? 1));
