// Runs a command with the local Supabase env added: `node scripts/with-env.mjs vitest run`.
import { spawn } from 'node:child_process';
import { supabaseEnv } from './supabase-env.mjs';

// Quote arguments with spaces so `npm test -- -t "loaded all"` survives the shell (sh on Mac/Linux, cmd on Windows).
const cmd = process.argv.slice(2).map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
const child = spawn(cmd, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...supabaseEnv() },
});
child.on('exit', (code) => process.exit(code ?? 1));
