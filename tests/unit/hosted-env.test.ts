import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

const script = "import { supabaseEnv } from './scripts/supabase-env.mjs'; console.log(JSON.stringify(supabaseEnv()));";
const env = {
  ...process.env, VERCEL: '1', SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-placeholder',
  SUPABASE_SECRET_KEY: 'private-placeholder',
};

it('uses hosted credentials without invoking local Docker', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({
    SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
  });
});

it('fails clearly when Vercel credentials are incomplete', () => {
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...env, SUPABASE_SECRET_KEY: '' }, stdio: 'pipe',
  })).toThrow(/Set the hosted Supabase URL/);
});
