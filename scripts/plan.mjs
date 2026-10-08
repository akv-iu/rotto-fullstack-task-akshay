// Local testing helper: set a company's plan and give back its free search.
//   npm run plan -- free            both companies: free plan, 1 search left
//   npm run plan -- paid acme       acme: paid (unlimited searches)
// Uses the local service key, like setup. Lists and saved searches are untouched.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from './supabase-env.mjs';

const [plan, slug] = process.argv.slice(2);
if (!['free', 'paid'].includes(plan) || (slug && !['acme', 'globex'].includes(slug))) {
  console.error('Usage: npm run plan -- free|paid [acme|globex]');
  process.exit(1);
}
const env = supabaseEnv();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const slugs = slug ? [slug] : ['acme', 'globex'];
const { data: companies, error } = await db.from('companies').select('id, slug').in('slug', slugs);
if (error) throw new Error(error.message);
for (const c of companies) {
  // Drop subscriptions so a later billing event can't flip the plan back unexpectedly.
  await db.from('subscriptions').delete().eq('company_id', c.id);
  const { error: e } = await db.from('companies').update({ plan, searches_used: 0 }).eq('id', c.id);
  if (e) throw new Error(e.message);
  console.log(`${c.slug}: ${plan}${plan === 'free' ? ', 1 search left' : ', unlimited searches'}`);
}
console.log('Reload the page to see it.');
