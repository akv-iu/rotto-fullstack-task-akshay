# Phase 1: The gate

Goal: a clean clone → `make setup` → `make dev` serves the app on :3000 with all 5,000 candidates and both logins, and CI proves it on every push. Worth 0 points, but it blocks all 100.

**Prerequisites (the user's machine):** Node 24 (`node -v` → `v24.x`), Docker Desktop **running** (`docker info` succeeds), and `make` if available (otherwise use the npm scripts).

---

### Task 1: Scaffold the Next.js 16 app and tooling

**Files:**
- Create: `package.json`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `tests/stubs/server-only.ts`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (temporary), `Makefile`
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm scripts `db:setup`, `dev`, `build`, `test`, `test:unit`; the path alias `@/*` → repo root; Vitest with `server-only` stubbed.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "rotto-recruiter",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "db:setup": "(supabase start || supabase status) && supabase db reset && node scripts/setup-data.mjs",
    "dev": "node scripts/dev.mjs",
    "build": "node scripts/with-env.mjs next build",
    "test": "node scripts/with-env.mjs vitest run",
    "test:unit": "vitest run tests/unit"
  }
}
```

`(supabase start || supabase status)` keeps `make setup` re-runnable: if the stack is already up, `start` may exit non-zero, but `status` confirms it is running.

- [ ] **Step 2: Install dependencies (exact versions recorded in the lockfile)**

```bash
echo 24 > .nvmrc
npm install next@16 react@19 react-dom@19 @supabase/supabase-js@2 zod@4 server-only @phosphor-icons/react @radix-ui/react-dialog @radix-ui/react-popover
npm install -D --save-exact supabase@2.119.0
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss@4 @tailwindcss/postcss vitest
```
Expected: `npx supabase --version` prints `2.119.0`.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "docs"]
}
```

- [ ] **Step 4: Write `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, the stub**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Photos and logos are loaded by the browser with plain <img>; the image host blocks server fetches.
  images: { unoptimized: true },
};

export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      { find: 'server-only', replacement: `${root}/tests/stubs/server-only.ts` },
    ],
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000, fileParallelism: false },
});
```

`tests/stubs/server-only.ts`:
```ts
// Vitest runs outside React Server Components, where the real `server-only` throws on import.
export {};
```

- [ ] **Step 5: Write the minimal app shell**

`app/globals.css`:
```css
@import "tailwindcss";
```

`app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Rotto', description: 'Find candidates by describing them in plain English.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (temporary; replaced in Phase 6):
```tsx
export default function Home() {
  return <main>Rotto</main>;
}
```

- [ ] **Step 6: Write the `Makefile` (recipe lines start with a TAB)**

```make
.PHONY: setup dev test

setup:
	npm ci
	npm run db:setup

dev:
	npm run dev

test:
	npm test
```

- [ ] **Step 7: Extend `.gitignore`**

Append:
```
lib/shared/vocab.ts
next-env.d.ts
*.tsbuildinfo
supabase/.temp/
supabase/.branches/
```

- [ ] **Step 8: Verify the build compiles**

Run: `npx next build`
Expected: "Compiled successfully" (the env wrapper isn't needed yet).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .nvmrc tsconfig.json next.config.ts postcss.config.mjs vitest.config.ts tests/stubs app Makefile .gitignore
git commit -m "chore: scaffold Next.js 16 app, tooling and Makefile"
```

---

### Task 2: Local Supabase, schema, seed, and data loading

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/20261008000000_schema.sql`, `supabase/seed.sql`, `scripts/supabase-env.mjs`, `scripts/setup-data.mjs`, `scripts/dev.mjs`, `scripts/with-env.mjs`, `tests/helpers.ts`, `tests/gate.test.ts`

**Interfaces:**
- Consumes: npm scripts from Task 1.
- Produces:
  - `supabaseEnv(): { SUPABASE_URL, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }` (from `scripts/supabase-env.mjs`)
  - tables (RLS added in Task 4): `candidates`, `companies`, `recruiters`, `searches`, `shortlists`, `shortlist_members`, `saved_briefs`, `subscriptions`, `billing_events`
  - company IDs: acme `a0000000-0000-4000-8000-000000000001`, globex `b0000000-0000-4000-8000-000000000002`
  - generated `lib/shared/vocab.ts` exporting `VOCAB` and `CITY_STATES`
  - test helpers: `BASE`, `COMPANY`, `admin()`, `signIn(slug)`, `asUser(token)`, `api(token, method, path, body?)`

- [ ] **Step 1: Initialise Supabase (one time; answer "n" to editor prompts)**

```bash
echo n | npx supabase init
```
Expected: `supabase/config.toml` exists. Leave defaults (`[db.seed] enabled = true`, `sql_paths = ["./seed.sql"]`).

- [ ] **Step 2: Write the schema migration `supabase/migrations/20261008000000_schema.sql`**

```sql
-- Tables and indexes. Security (grants, RLS) is in the functions/security migration.

create table public.companies (
  id uuid primary key,
  slug text not null unique check (slug in ('acme', 'globex')),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  searches_used int not null default 0 check (searches_used >= 0)
);

create table public.recruiters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id)
);

create table public.candidates (
  id text primary key check (id ~ '^cand_[0-9]{4}$'),
  full_name text not null,
  avatar_url text not null,
  headline text not null,
  current_title text not null,
  current_company text not null,
  current_company_logo_url text not null,
  current_company_type text not null,
  role text not null,
  seniority text not null,
  years_experience int not null,
  city text not null,
  state text not null,
  open_to_work boolean not null,
  skills text[] not null,
  companies text[] not null,
  company_types text[] not null,
  degrees text[] not null,
  fields text[] not null,
  schools text[] not null,
  profile jsonb not null
);
create index candidates_role_idx on public.candidates (role);
create index candidates_seniority_idx on public.candidates (seniority);
create index candidates_city_idx on public.candidates (city);
create index candidates_years_idx on public.candidates (years_experience);
create index candidates_skills_gin on public.candidates using gin (skills);
create index candidates_companies_gin on public.candidates using gin (companies);
create index candidates_company_types_gin on public.candidates using gin (company_types);
create index candidates_degrees_gin on public.candidates using gin (degrees);
create index candidates_fields_gin on public.candidates using gin (fields);
create index candidates_schools_gin on public.candidates using gin (schools);

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  brief text not null check (char_length(brief) between 1 and 500),
  filters jsonb,
  status text not null check (status in ('pending', 'ready', 'refunded')),
  root_id uuid references public.searches (id),
  corrections_used int not null default 0,
  created_at timestamptz not null default now()
);
create index searches_company_idx on public.searches (company_id);

create table public.shortlists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.shortlist_members (
  shortlist_id uuid not null,
  company_id uuid not null,
  candidate_id text not null references public.candidates (id),
  added_at timestamptz not null default now(),
  primary key (shortlist_id, candidate_id),
  foreign key (shortlist_id, company_id) references public.shortlists (id, company_id) on delete cascade
);

create table public.saved_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  brief text not null check (char_length(brief) between 1 and 500),
  filters jsonb not null,
  created_at timestamptz not null default now()
);
create index saved_briefs_company_idx on public.saved_briefs (company_id, created_at desc);

create table public.subscriptions (
  stripe_subscription_id text primary key,
  company_id uuid not null references public.companies (id),
  status text not null,
  last_event_created bigint not null,
  last_event_type text not null
);

create table public.billing_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
```

- [ ] **Step 3: Write `supabase/seed.sql`**

```sql
insert into public.companies (id, slug, name) values
  ('a0000000-0000-4000-8000-000000000001', 'acme', 'Acme'),
  ('b0000000-0000-4000-8000-000000000002', 'globex', 'Globex');
```

- [ ] **Step 4: Write `scripts/supabase-env.mjs`**

```js
// Reads the local Supabase URL and keys from the running stack, so no .env file is ever needed.
import { execSync } from 'node:child_process';

export function supabaseEnv() {
  const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  const url = s.API_URL;
  // CLI 2.x prints the new key names; older output used ANON_KEY / SERVICE_ROLE_KEY. Accept either.
  const publishable = s.PUBLISHABLE_KEY ?? s.ANON_KEY;
  const secret = s.SECRET_KEY ?? s.SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) throw new Error('Supabase is not running. Run `make setup` first.');
  return {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: secret,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  };
}
```

- [ ] **Step 5: Write `scripts/with-env.mjs` and `scripts/dev.mjs`**

`scripts/with-env.mjs`:
```js
// Runs a command with the local Supabase env added: `node scripts/with-env.mjs vitest run`.
import { spawn } from 'node:child_process';
import { supabaseEnv } from './supabase-env.mjs';

const child = spawn(process.argv.slice(2).join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...supabaseEnv() },
});
child.on('exit', (code) => process.exit(code ?? 1));
```

`scripts/dev.mjs`:
```js
// `make dev`: serve the app on :3000 with the Supabase env plus the grader's OPENAI_API_KEY / STRIPE_WEBHOOK_SECRET.
import { spawn } from 'node:child_process';
import { supabaseEnv } from './supabase-env.mjs';

const child = spawn('npx next dev -p 3000', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...supabaseEnv() },
});
child.on('exit', (code) => process.exit(code ?? 1));
```

- [ ] **Step 6: Write `scripts/setup-data.mjs`**

```js
// `make setup`, after the DB reset: create the two recruiters, load all candidates, generate the allowed-value lists.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from './supabase-env.mjs';

const env = supabaseEnv();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = async (query) => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

// 1. Recruiters (db reset wipes auth.users, so createUser normally succeeds; tolerate re-runs anyway).
const RECRUITERS = [
  { email: 'recruiter@acme.test', slug: 'acme' },
  { email: 'recruiter@globex.test', slug: 'globex' },
];
for (const r of RECRUITERS) {
  const created = await admin.auth.admin.createUser({ email: r.email, password: 'rotto-assessment', email_confirm: true });
  let userId = created.data?.user?.id;
  if (!userId) {
    const { users } = await must(admin.auth.admin.listUsers());
    userId = users.find((u) => u.email === r.email)?.id;
    if (!userId) throw new Error(`Could not create ${r.email}: ${created.error?.message}`);
  }
  const company = await must(admin.from('companies').select('id').eq('slug', r.slug).single());
  await must(admin.from('recruiters').upsert({ user_id: userId, company_id: company.id }));
}

// 2. Candidates.
const raw = JSON.parse(readFileSync('data/candidates.json', 'utf8'));
const rows = raw.map((c) => {
  const current = c.experiences.find((e) => e.end_year === null) ?? c.experiences[0];
  return {
    id: c.id,
    full_name: c.full_name,
    avatar_url: c.avatar_url,
    headline: c.headline,
    current_title: c.current_title,
    current_company: c.current_company,
    current_company_logo_url: c.current_company_logo_url,
    current_company_type: current.company_type,
    role: c.role,
    seniority: c.seniority,
    years_experience: c.years_experience,
    city: c.location.city,
    state: c.location.state,
    open_to_work: c.open_to_work,
    skills: c.skills,
    companies: [...new Set(c.experiences.map((e) => e.company))],
    company_types: [...new Set(c.experiences.map((e) => e.company_type))],
    degrees: [...new Set(c.education.map((e) => e.degree))],
    fields: [...new Set(c.education.map((e) => e.field))],
    schools: [...new Set(c.education.map((e) => e.school))],
    profile: c,
  };
});
for (let i = 0; i < rows.length; i += 500) await must(admin.from('candidates').upsert(rows.slice(i, i + 500)));
const { count } = await admin.from('candidates').select('id', { count: 'exact', head: true });
if (count !== raw.length) throw new Error(`Loaded ${count} candidates, expected ${raw.length}`);

// 3. Allowed-value lists, built from the same file (decision: built at setup, see docs/NOTES.md).
const uniq = (f) => [...new Set(raw.flatMap(f))].sort();
const VOCAB = {
  roles: uniq((c) => [c.role]),
  seniorities: ['junior', 'mid', 'senior', 'staff'].filter((s) => raw.some((c) => c.seniority === s)),
  skills: uniq((c) => c.skills),
  cities: uniq((c) => [c.location.city]),
  companies: uniq((c) => c.experiences.map((e) => e.company)),
  degrees: uniq((c) => c.education.map((e) => e.degree)),
  fields: uniq((c) => c.education.map((e) => e.field)),
  schools: uniq((c) => c.education.map((e) => e.school)),
};
const CITY_STATES = Object.fromEntries(raw.map((c) => [c.location.city, c.location.state]));
mkdirSync('lib/shared', { recursive: true });
writeFileSync(
  'lib/shared/vocab.ts',
  `// GENERATED by scripts/setup-data.mjs from data/candidates.json. Do not edit.\n` +
    `export const VOCAB = ${JSON.stringify(VOCAB, null, 2)} as const;\n\n` +
    `export const CITY_STATES: Record<string, string> = ${JSON.stringify(CITY_STATES, null, 2)};\n`,
);

console.log(`Setup complete: ${count} candidates, 2 recruiters, vocab written.`);
```

- [ ] **Step 7: Write `tests/helpers.ts`**

```ts
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
```

- [ ] **Step 8: Write the failing gate test `tests/gate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { BASE, admin, signIn } from './helpers';

describe('gate', () => {
  it('loaded all 5,000 candidates', async () => {
    const { count } = await admin().from('candidates').select('id', { count: 'exact', head: true });
    expect(count).toBe(5000);
  });

  it('both seeded recruiters can sign in', async () => {
    expect(await signIn('acme')).toBeTruthy();
    expect(await signIn('globex')).toBeTruthy();
  });

  it('serves the app on :3000', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 9: Run it to see it fail (stack not set up yet)**

Run: `npm test -- tests/gate.test.ts`
Expected: FAIL with "Supabase is not running".

- [ ] **Step 10: Run setup, start the app, re-run**

```bash
npm run db:setup          # or: make setup
npm run dev               # second terminal; or: make dev
npm test -- tests/gate.test.ts
```
Expected: `Setup complete: 5000 candidates, 2 recruiters, vocab written.` and 3 tests PASS. Run `npm run db:setup` a **second time** and re-run the test: it must still pass (setup is idempotent).

- [ ] **Step 11: Commit**

```bash
git add supabase scripts tests/helpers.ts tests/gate.test.ts
git commit -m "feat: local Supabase schema, seed, candidate loader and dev scripts"
```

---

### Task 3: Clean-machine check on GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `make setup`, `make dev`, `make test`.
- Produces: a CI run on every push; repository secret `OPENAI_API_KEY` (optional; the accuracy tests skip without it).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: clean-machine
on: [push]

jobs:
  setup-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      # Deliberately NOT the sample secret: proves we work with the grader's own secret.
      STRIPE_WEBHOOK_SECRET: whsec_ci_not_the_sample_secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: make setup (no .env, no manual steps)
        run: make setup
      - name: make dev
        run: |
          (make dev > dev.log 2>&1 &)
          for i in $(seq 90); do curl -sf http://localhost:3000 > /dev/null && exit 0; sleep 2; done
          cat dev.log; exit 1
      - name: make test
        run: make test
```

- [ ] **Step 2: Add the repository secret (user, one time)**

GitHub → repo → Settings → Secrets and variables → Actions → New secret `OPENAI_API_KEY`. Optional: without it, CI still proves setup and every non-AI test.

- [ ] **Step 3: Push and watch it pass**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: clean-machine setup and tests on every push"
git push
gh run watch
```
Expected: the `clean-machine` run succeeds (the gate test passes on a fresh Ubuntu machine).
