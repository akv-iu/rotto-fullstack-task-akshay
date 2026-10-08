# Phase 6: UI

> **In short:** Builds every screen in DESIGN.md (sign-in, search with editable filter chips, profile, shortlists, saved searches) in light and dark, for desktop and a 375 px phone.
> Pages talk only to our own `/api` with the recruiter's sign-in token, so no secret key ever reaches the browser.

Goal: every screen and state in [DESIGN.md](../DESIGN.md), in Graphite & Signal (light and dark), working on desktop and at 375 px. Pages are client components that call `/api` with the session token. Worth 20 points.

**Rules for every task here:** the tokens from DESIGN §5 only (no raw colours in components); plain `<img>` for photos and logos; labels above inputs; every control keyboard-reachable; no em-dashes in copy; one name per action ("Shortlist", "Save search", "Upgrade").

**How to verify UI tasks:** `npm run build` must pass (type-check; it adds the Supabase env the pages need), then check in the browser at **1280 px and 375 px wide**, in **light and dark** (OS setting or DevTools "prefers-color-scheme"), against the task's checklist. Take a screenshot of each for the Loom.

---

### Task 13: Design tokens, sign-in, and the app shell

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`
- Delete: `app/page.tsx` (replaced by `app/(app)/page.tsx` in Task 15)
- Create: `lib/client/supabase.ts`, `lib/client/api.ts`, `components/ui.tsx`, `components/app-shell.tsx`, `app/sign-in/page.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx` (placeholder until Task 15)

**Interfaces:**
- Produces:
  - `supabase` (browser client, publishable key only)
  - `api<T>(path, { method?, body? }?): Promise<T>`; `class ApiError { status: number; message: string }`
  - `cx(...classes)`, `Button` (`variant: 'primary' | 'secondary' | 'quiet'`), `Skeleton`
  - `useAppState(): { plan, refreshPlan, lists, refreshLists, openUpgrade }`
  - `PlanBanner`

- [ ] **Step 1: Replace `app/globals.css`**

```css
@import "tailwindcss";

:root {
  --bg: #f6f6f5; --surface: #ffffff; --ink: #1c1c1a; --muted: #6f6f6a; --line: #efefed; --border: #d6d6d2;
  --accent: #c2410c; --accent-fg: #ffffff; --accent-soft: #fdf0e9; --accent-line: #f5c6ad;
  --warn: #92400e; --warn-soft: #fef6e7; --warn-line: #f3d79b;
  --danger: #b42318; --danger-soft: #fef3f2; --skeleton: #ececea;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111110; --surface: #191918; --ink: #f2f2f0; --muted: #a3a39d; --line: #252524; --border: #363634;
    --accent: #ff8a4c; --accent-fg: #111110; --accent-soft: #2c1c13; --accent-line: #5a3320;
    --warn: #f5c48a; --warn-soft: #2a2010; --warn-line: #5a4520;
    --danger: #ff8a80; --danger-soft: #2c1514; --skeleton: #252524;
    color-scheme: dark;
  }
}

@theme inline {
  --color-bg: var(--bg); --color-surface: var(--surface); --color-ink: var(--ink); --color-muted: var(--muted);
  --color-line: var(--line); --color-border: var(--border);
  --color-accent: var(--accent); --color-accent-fg: var(--accent-fg); --color-accent-soft: var(--accent-soft); --color-accent-line: var(--accent-line);
  --color-warn: var(--warn); --color-warn-soft: var(--warn-soft); --color-warn-line: var(--warn-line);
  --color-danger: var(--danger); --color-danger-soft: var(--danger-soft); --color-skeleton: var(--skeleton);
  --color-overlay: rgb(0 0 0 / 0.45); /* dialog backdrop, same in both themes */
  --font-sans: var(--font-instrument), system-ui, sans-serif;
}

/* In layers, so Tailwind utilities (rounded-full, outline-none) still win over these defaults. */
@layer base {
  body { background: var(--bg); color: var(--ink); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
}
@layer components {
  .skeleton { background: var(--skeleton); border-radius: 6px; animation: pulse 1.4s ease-in-out infinite; }
}
@keyframes pulse { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 2: Replace `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import './globals.css';

const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' });

export const metadata: Metadata = { title: 'Rotto', description: 'Find candidates by describing them in plain English.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={instrument.variable}>
      <body className="min-h-dvh font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Write `lib/client/supabase.ts` and `lib/client/api.ts`**

`lib/client/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js';

// Browser client: the URL and the publishable key only (both public by design). Used for sign-in and the session token.
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
```

`lib/client/api.ts`:
```ts
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
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'Something went wrong. Please try again.');
  return json as T;
}
```

- [ ] **Step 4: Write `components/ui.tsx`**

```tsx
import type { ComponentProps } from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-ink hover:bg-bg',
  quiet: 'text-muted hover:text-ink',
  accent: 'border border-accent bg-surface text-accent hover:bg-accent-soft', // Upgrade: one variant, not overrides (they lost to secondary's colours)
} as const;

// 44 px tall on phones (SCORING: tap targets >= 44 px), 36 px from md up.
export const buttonClass = (variant: keyof typeof VARIANTS = 'secondary', className?: string) => cx(
  'inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  VARIANTS[variant],
  className,
);

// ComponentProps<'button'> includes `ref` in React 19, so callers can pass one without forwardRef.
export function Button({ variant = 'secondary', className, ...props }: ComponentProps<'button'> & { variant?: keyof typeof VARIANTS }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('skeleton block', className)} />;
}
```

- [ ] **Step 5: Write `components/app-shell.tsx`**

```tsx
'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { BookmarkSimple, ListChecks, MagnifyingGlass, SignOut } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { supabase } from '@/lib/client/supabase';
import { Button, Skeleton, cx } from './ui';

export type Plan = { plan: 'free' | 'paid'; searches_remaining: number | null };
export type ShortlistSummary = { id: string; name: string; count: number; candidate_ids: string[] };

type AppState = {
  plan: Plan | null;
  refreshPlan: () => Promise<void>;
  lists: ShortlistSummary[] | null;
  refreshLists: () => Promise<void>;
  openUpgrade: () => void;
};
const AppStateContext = createContext<AppState | null>(null);
export const useAppState = () => useContext(AppStateContext)!;

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [lists, setLists] = useState<ShortlistSummary[] | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const refreshPlan = useCallback(async () => setPlan(await api<Plan>('/api/plan')), []);
  const refreshLists = useCallback(async () => setLists(await api<ShortlistSummary[]>('/api/shortlists')), []);
  useEffect(() => {
    refreshPlan().catch(() => {});
    refreshLists().catch(() => {});
  }, [refreshPlan, refreshLists]);
  return (
    <AppStateContext.Provider value={{ plan, refreshPlan, lists, refreshLists, openUpgrade: () => setUpgradeOpen(true) }}>
      {children}
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </AppStateContext.Provider>
  );
}

const LINKS = [
  { href: '/', label: 'Search', Icon: MagnifyingGlass },
  { href: '/shortlists', label: 'Shortlists', Icon: ListChecks },
  { href: '/saved', label: 'Saved searches', Icon: BookmarkSimple },
];
const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 md:px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">Rotto</Link>
        <nav aria-label="Main" className="hidden gap-5 text-sm md:flex">
          {LINKS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={isActive(pathname, href) ? 'font-medium text-ink' : 'text-muted hover:text-ink'}>{label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <PlanStatus />
          <Button variant="quiet" aria-label="Sign out" onClick={() => supabase.auth.signOut()} className="min-w-11 px-1"><SignOut size={18} /></Button>
        </div>
      </div>
    </header>
  );
}

function PlanStatus() {
  const { plan, openUpgrade } = useAppState();
  if (!plan) return <Skeleton className="h-5 w-40" />;
  if (plan.plan === 'paid') return <span className="text-sm text-muted">Paid plan</span>;
  const n = plan.searches_remaining ?? 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted"><span className="hidden sm:inline">Free plan · </span>{n} {n === 1 ? 'search' : 'searches'} left</span>
      <Button variant="accent" onClick={openUpgrade}>Upgrade</Button>
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {LINKS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
          className={cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs', isActive(pathname, href) ? 'font-medium text-ink' : 'text-muted')}>
          <Icon size={20} weight={isActive(pathname, href) ? 'fill' : 'regular'} />
          {label === 'Saved searches' ? 'Saved' : label}
        </Link>
      ))}
    </nav>
  );
}

export function PlanBanner() {
  const { plan, openUpgrade } = useAppState();
  if (plan?.plan !== 'free' || plan.searches_remaining !== 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-accent-line bg-accent-soft p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-medium">You&apos;ve used your free search.</p>
        <p className="text-sm text-muted">You can still refine its filters, open candidates, and shortlist. Upgrade to run new searches.</p>
      </div>
      <Button variant="primary" onClick={openUpgrade}>Upgrade</Button>
    </div>
  );
}

function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold">Upgrade to the paid plan</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Unlimited searches for everyone at your company.</Dialog.Description>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            <li>Your admin subscribes through Stripe.</li>
            <li>Stripe confirms the payment with us.</li>
            <li>Your plan switches to paid automatically, usually within seconds.</li>
          </ol>
          <Dialog.Close asChild><Button variant="primary" className="mt-6">Got it</Button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 6: Write `app/sign-in/page.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/client/supabase';
import { Button } from '@/components/ui';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace('/'); });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError('That email and password do not match.');
    else router.replace('/');
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to Rotto</h1>
        <label className="mt-6 block text-sm font-medium" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2" />
        <label className="mt-4 block text-sm font-medium" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2" />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-6 w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Write `app/(app)/layout.tsx` (the one sign-in guard) and a placeholder page**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppStateProvider, BottomNav, TopBar } from '@/components/app-shell';
import { Skeleton } from '@/components/ui';
import { supabase } from '@/lib/client/supabase';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => (data.session ? setSignedIn(true) : router.replace('/sign-in')));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (!session) router.replace('/sign-in'); });
    return () => data.subscription.unsubscribe();
  }, [router]);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <AppStateProvider>
      <TopBar />
      <main className="mx-auto max-w-[1400px] pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AppStateProvider>
  );
}
```

`app/(app)/page.tsx` (placeholder; Task 15 replaces it):
```tsx
export default function SearchPage() {
  return <p className="p-6 text-muted">Search arrives in Task 15.</p>;
}
```

- [ ] **Step 8: Verify**

```bash
rm app/page.tsx
npm run build
npm run dev
```
Checklist: `/` while signed out → redirects to `/sign-in`; a wrong password → "That email and password do not match."; sign in as acme → top bar shows **"Free plan · 1 search left"** + **Upgrade**; Upgrade opens the dialog, Esc closes it; at 375 px the bottom nav shows Search / Shortlists / Saved; sign out returns to `/sign-in`; dark mode uses the dark tokens.

- [ ] **Step 9: Commit**

```bash
git add -A app components lib/client
git commit -m "feat: design tokens, sign-in, app shell with plan and upgrade"
```

---

### Task 14: The filter chips (graded: "see the filters … and correct them easily")

**Files:**
- Create: `components/search/chip-model.ts`, `components/search/ChipBar.tsx`
- Test: `tests/unit/chips.test.ts`

**Interfaces:**
- Consumes: `Filters`, `LIST_KEYS`, `CHIP_LABELS`, `ListKey` (Task 6), `VOCAB`.
- Produces:
  - `type Chip`, `chipsOf(filters): Chip[]`, `removeChip(filters, chip): Filters`, `replaceValue(filters, key, oldValue | null, newValue): Filters`, `setScalar(filters, key, value): Filters`, `optionsFor(key): readonly string[]`, `display(key, value): string`
  - `<ChipBar filters onChange(filters) disabled? />`

- [ ] **Step 1: Write the failing test `tests/unit/chips.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { chipsOf, removeChip, replaceValue, setScalar } from '@/components/search/chip-model';

const f = {
  seniorities: ['senior'], skills: ['React', 'AWS'], cities: ['New York'], worked_at_company_type: 'startup' as const,
  unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' as const }],
};

describe('chip model', () => {
  it('makes one chip per value, plus scalar and unsupported chips', () => {
    expect(chipsOf(f).map((c) => (c.kind === 'unsupported' ? `!${c.text}` : `${c.label}:${c.text}`))).toEqual([
      'Seniority:Senior', 'City:New York', 'Skill:React', 'Skill:AWS', 'Worked at a:startup', '!speaks Japanese',
    ]);
  });

  it('removes exactly one value, and drops the key when it was the last', () => {
    const chips = chipsOf(f);
    expect(removeChip(f, chips.find((c) => c.kind === 'list' && c.value === 'AWS')!).skills).toEqual(['React']);
    expect(removeChip(f, chips.find((c) => c.kind === 'list' && c.value === 'New York')!)).not.toHaveProperty('cities');
    expect(removeChip(f, chips.find((c) => c.kind === 'unsupported')!)).not.toHaveProperty('unsupported');
    expect(removeChip(f, chips.find((c) => c.kind === 'scalar')!)).not.toHaveProperty('worked_at_company_type');
  });

  it('replaces or adds a value without duplicates, and never mutates the input', () => {
    expect(replaceValue(f, 'cities', 'New York', 'Boston').cities).toEqual(['Boston']);
    expect(replaceValue(f, 'skills', null, 'Go').skills).toEqual(['React', 'AWS', 'Go']);
    expect(replaceValue(f, 'skills', 'AWS', 'React').skills).toEqual(['React']);
    expect(setScalar(f, 'min_years', 5).min_years).toBe(5);
    expect(f.skills).toEqual(['React', 'AWS']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- tests/unit/chips.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `components/search/chip-model.ts`**

```ts
import { CHIP_LABELS, LIST_KEYS, type Filters, type ListKey } from '@/lib/shared/filters';
import { VOCAB } from '@/lib/shared/vocab';

export type ScalarKey = 'min_years' | 'max_years' | 'open_to_work' | 'worked_at_company_type' | 'current_company_type';
export type Chip =
  | { kind: 'list'; key: ListKey; value: string; label: string; text: string }
  | { kind: 'scalar'; key: ScalarKey; label: string; text: string }
  | { kind: 'unsupported'; index: number; text: string; reason: 'unsupported' | 'unclear' };

// Display order: who, where, what they know, where they worked, education.
const ORDER: ListKey[] = ['roles', 'seniorities', 'cities', 'skills', 'any_skills', 'companies', 'current_companies', 'degrees', 'fields', 'schools'];

export const optionsFor = (key: ListKey): readonly string[] => VOCAB[LIST_KEYS[key]];
export const display = (key: ListKey, value: string) => (key === 'seniorities' ? value[0].toUpperCase() + value.slice(1) : value);

export function chipsOf(f: Filters): Chip[] {
  const chips: Chip[] = [];
  for (const key of ORDER) {
    for (const value of f[key] ?? []) chips.push({ kind: 'list', key, value, label: CHIP_LABELS[key], text: display(key, value) });
  }
  if (f.min_years != null) chips.push({ kind: 'scalar', key: 'min_years', label: CHIP_LABELS.min_years, text: `${f.min_years} yrs` });
  if (f.max_years != null) chips.push({ kind: 'scalar', key: 'max_years', label: CHIP_LABELS.max_years, text: `${f.max_years} yrs` });
  if (f.open_to_work) chips.push({ kind: 'scalar', key: 'open_to_work', label: '', text: 'Open to work' });
  if (f.worked_at_company_type) chips.push({ kind: 'scalar', key: 'worked_at_company_type', label: CHIP_LABELS.worked_at_company_type, text: f.worked_at_company_type });
  if (f.current_company_type) chips.push({ kind: 'scalar', key: 'current_company_type', label: CHIP_LABELS.current_company_type, text: f.current_company_type });
  (f.unsupported ?? []).forEach((u, index) => chips.push({ kind: 'unsupported', index, text: u.text, reason: u.reason }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  const next: Filters = structuredClone(f);
  if (chip.kind === 'list') {
    const rest = (next[chip.key] ?? []).filter((v) => v !== chip.value);
    if (rest.length) next[chip.key] = rest; else delete next[chip.key];
  } else if (chip.kind === 'scalar') {
    delete next[chip.key];
  } else {
    const rest = (next.unsupported ?? []).filter((_, i) => i !== chip.index);
    if (rest.length) next.unsupported = rest; else delete next.unsupported;
  }
  return next;
}

export function replaceValue(f: Filters, key: ListKey, oldValue: string | null, newValue: string): Filters {
  const next: Filters = structuredClone(f);
  const current = next[key] ?? [];
  const at = oldValue === null ? -1 : current.indexOf(oldValue);
  const updated = at >= 0 ? current.map((v, i) => (i === at ? newValue : v)) : [...current, newValue];
  next[key] = [...new Set(updated)];
  return next;
}

export function setScalar<K extends ScalarKey>(f: Filters, key: K, value: Filters[K]): Filters {
  const next: Filters = structuredClone(f);
  next[key] = value;
  return next;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- tests/unit/chips.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `components/search/ChipBar.tsx`**

```tsx
'use client';
import * as Popover from '@radix-ui/react-popover';
import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { CHIP_LABELS, type Filters, type ListKey } from '@/lib/shared/filters';
import { Button, cx } from '@/components/ui';
import { chipsOf, display, optionsFor, removeChip, replaceValue, setScalar, type Chip } from './chip-model';

type Props = { filters: Filters; onChange: (filters: Filters) => void; disabled?: boolean };

const POPOVER = 'z-30 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl';
const CHIP = 'inline-flex shrink-0 items-center rounded-full border text-sm';

export function ChipBar({ filters, onChange, disabled }: Props) {
  const chips = chipsOf(filters);
  return (
    <div role="group" aria-label="Filters the search understood"
      className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {chips.map((chip) => (
        <ChipView key={chip.kind === 'unsupported' ? `u${chip.index}` : `${chip.key}:${chip.kind === 'list' ? chip.value : ''}`}
          chip={chip} filters={filters} onChange={onChange} disabled={disabled} />
      ))}
      <AddFilter filters={filters} onChange={onChange} disabled={disabled} />
      {chips.length > 0 && (
        <button type="button" disabled={disabled} onClick={() => onChange({})}
          className="min-h-11 shrink-0 text-sm text-muted underline underline-offset-2 hover:text-ink md:min-h-0">Clear filters</button>
      )}
    </div>
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={`Remove ${label}`} disabled={disabled} onClick={onClick}
      className="-my-2 grid size-11 place-items-center rounded-full text-muted hover:text-ink md:my-0 md:size-7"><X size={12} weight="bold" /></button>
  );
}

function ChipView({ chip, filters, onChange, disabled }: { chip: Chip } & Props) {
  const [open, setOpen] = useState(false);
  if (chip.kind === 'unsupported') {
    const note = chip.reason === 'unclear' ? 'unclear, pick a filter' : 'not in our data';
    return (
      <span className={cx(CHIP, 'border-warn-line bg-warn-soft pl-3 text-warn')}>
        {chip.text} · {note}
        <RemoveButton label={chip.text} disabled={disabled} onClick={() => onChange(removeChip(filters, chip))} />
      </span>
    );
  }
  const name = `${chip.label} ${chip.text}`.trim();
  const editable = !(chip.kind === 'scalar' && chip.key === 'open_to_work');
  return (
    <span className={cx(CHIP, 'border-border bg-surface pl-3', open && 'border-accent ring-2 ring-accent/20')}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild disabled={disabled || !editable}>
          <button type="button" className="min-h-11 py-1 md:min-h-0" aria-label={editable ? `Change ${name}` : name}>
            {chip.label && <span className="text-muted">{chip.label} </span>}{chip.text}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} align="start" className={POPOVER}>
            {chip.kind === 'list' ? (
              <OptionPicker listKey={chip.key} selected={chip.value}
                onPick={(v) => { setOpen(false); onChange(replaceValue(filters, chip.key, chip.value, v)); }} />
            ) : chip.key === 'min_years' || chip.key === 'max_years' ? (
              <YearsPicker initial={filters[chip.key] ?? 0} onPick={(n) => { setOpen(false); onChange(setScalar(filters, chip.key as 'min_years', n)); }} />
            ) : (
              <CompanyTypePicker onPick={(t) => { setOpen(false); onChange(setScalar(filters, chip.key as 'worked_at_company_type', t)); }} />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <RemoveButton label={name} disabled={disabled} onClick={() => onChange(removeChip(filters, chip))} />
    </span>
  );
}

function OptionPicker({ listKey, selected, onPick }: { listKey: ListKey; selected?: string; onPick: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const options = optionsFor(listKey).filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div>
      <label className="sr-only" htmlFor={`pick-${listKey}`}>Search {CHIP_LABELS[listKey]}</label>
      <input id={`pick-${listKey}`} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
        className="mb-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm" />
      <ul className="max-h-64 overflow-y-auto">
        {options.map((o) => (
          <li key={o}>
            <button type="button" onClick={() => onPick(o)}
              className={cx('flex min-h-11 w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg md:min-h-0', o === selected && 'bg-accent-soft font-medium text-accent')}>
              {display(listKey, o)}{o === selected && <span aria-hidden>✓</span>}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="px-2.5 py-1.5 text-sm text-muted">Not in our data</li>}
      </ul>
    </div>
  );
}

function YearsPicker({ initial, onPick }: { initial: number; onPick: (n: number) => void }) {
  const [n, setN] = useState(initial);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onPick(n); }} className="flex items-end gap-2 p-1">
      <label className="flex-1 text-sm">Years
        <input type="number" min={0} max={15} value={n} onChange={(e) => setN(Math.max(0, Math.min(15, Number(e.target.value))))}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5" />
      </label>
      <Button type="submit" variant="primary">Apply</Button>
    </form>
  );
}

function CompanyTypePicker({ onPick }: { onPick: (t: 'startup' | 'enterprise') => void }) {
  return (
    <div className="grid gap-1">
      {(['startup', 'enterprise'] as const).map((t) => (
        <button key={t} type="button" onClick={() => onPick(t)} className="rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg">{t}</button>
      ))}
    </div>
  );
}

const ADDABLE: { key: ListKey | 'min_years' | 'open_to_work' | 'worked_at_company_type'; label: string }[] = [
  { key: 'roles', label: 'Role' }, { key: 'seniorities', label: 'Seniority' }, { key: 'cities', label: 'City' },
  { key: 'skills', label: 'Skill' }, { key: 'min_years', label: 'Minimum years' }, { key: 'open_to_work', label: 'Open to work' },
  { key: 'worked_at_company_type', label: 'Worked at a startup or enterprise' }, { key: 'companies', label: 'Worked at company' },
  { key: 'degrees', label: 'Degree' }, { key: 'fields', label: 'Field of study' }, { key: 'schools', label: 'School' },
];

function AddFilter({ filters, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<(typeof ADDABLE)[number]['key'] | null>(null);
  const close = (next: Filters) => { setOpen(false); setStep(null); onChange(next); };
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setStep(null); }}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" className={cx(CHIP, 'min-h-11 border-dashed border-border px-3 py-1 text-muted hover:text-ink md:min-h-0')}>
          <Plus size={12} weight="bold" className="mr-1" />Filter
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" className={POPOVER}>
          {step === null && (
            <ul>
              {ADDABLE.map((a) => (
                <li key={a.key}>
                  <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg"
                    onClick={() => (a.key === 'open_to_work' ? close(setScalar(filters, 'open_to_work', true)) : setStep(a.key))}>{a.label}</button>
                </li>
              ))}
            </ul>
          )}
          {step === 'min_years' && <YearsPicker initial={5} onPick={(n) => close(setScalar(filters, 'min_years', n))} />}
          {step === 'worked_at_company_type' && <CompanyTypePicker onPick={(t) => close(setScalar(filters, 'worked_at_company_type', t))} />}
          {step && step !== 'min_years' && step !== 'worked_at_company_type' && step !== 'open_to_work' && (
            <OptionPicker listKey={step} onPick={(v) => close(replaceValue(filters, step, null, v))} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run build` (type-check). The chips are exercised in the browser in Task 15.
```bash
git add components/search tests/unit/chips.test.ts
git commit -m "feat: editable filter chips"
```

---

### Task 15: The search page

**Files:**
- Create: `components/search/ResultRow.tsx`, `components/search/states.tsx`
- Replace: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, `useAppState`, `PlanBanner`, `ChipBar`, `Button`, `Skeleton`; types `SearchResponse`, `PageResponse`, `CandidateCard` (`import type` from `@/lib/server/search`).
- Produces: `ResultRow({ candidate, filters, selected, onOpen })` (it renders `ShortlistButton` once Task 16 exists; until then the slot is empty); `FirstVisit`, `SearchingSkeleton`, `RowSkeletons`, `ErrorBar`, `NoResults`.

- [ ] **Step 1: Write `components/search/states.tsx`**

```tsx
'use client';
import { Warning } from '@phosphor-icons/react';
import type { Filters } from '@/lib/shared/filters';
import { Button, Skeleton } from '@/components/ui';
import { chipsOf } from './chip-model';

const EXAMPLES = [
  'senior React engineers in New York who have worked at a startup',
  'data scientists with a PhD',
  'product designers in San Francisco open to work',
];

export function FirstVisit({ onPick, freeLeft }: { onPick: (brief: string) => void; freeLeft: number | null }) {
  if (freeLeft === 0) return null; // the plan banner explains; examples would fill a disabled box
  return (
    <div className="mt-8 max-w-2xl">
      <h2 className="text-lg font-semibold">Describe the people you want, in plain English.</h2>
      <p className="mt-1 text-muted">Role, skills, city, seniority, experience, education. For example:</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Fills the box; never runs it, so a free user can't spend their search by accident. */}
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:border-accent">{e}</button>
        ))}
      </div>
      {freeLeft !== null && <p className="mt-4 text-sm text-muted">Free plan: {freeLeft} {freeLeft === 1 ? 'search' : 'searches'} included.</p>}
    </div>
  );
}

export function RowSkeletons({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden className="mt-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 border-t border-line px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <span className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-72 max-w-full" /></span>
        </li>
      ))}
    </ul>
  );
}

export function SearchingSkeleton() {
  return (
    <div aria-live="polite" className="mt-4">
      <div className="flex gap-2"><Skeleton className="h-7 w-24 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-7 w-28 rounded-full" /></div>
      <p className="mt-3 text-sm text-muted">Reading your brief…</p>
      <RowSkeletons />
    </div>
  );
}

export function ErrorBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-4 flex gap-3 rounded-xl bg-danger-soft p-4 text-danger">
      <Warning size={20} className="mt-0.5 shrink-0" />
      <div>
        <p>{message}</p>
        {onRetry && <Button className="mt-3" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}

export function NoResults({ filters, onClear }: { filters: Filters; onClear: () => void }) {
  const chips = chipsOf(filters);
  const blocked = chips.filter((c) => c.kind === 'unsupported');
  const real = chips.length - blocked.length;
  let title: string, body: string;
  if (blocked.length) {
    title = "Part of your brief isn't in our data, so we're not guessing.";
    body = 'Remove the highlighted filter to see results without it.';
  } else if (real === 0) {
    title = "There's nothing to search for yet.";
    body = 'We found no role, skill, city, seniority, experience or education in that. Add a filter, or describe who you want above.';
  } else {
    title = `No one matches all ${real} filters.`;
    body = "Remove a filter above to widen the search. Each change re-runs instantly and doesn't use a search.";
  }
  return (
    <div className="mt-6 max-w-xl">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      {real > 0 && !blocked.length && <Button className="mt-4" onClick={onClear}>Clear filters</Button>}
    </div>
  );
}
```

- [ ] **Step 2: Write `components/search/ResultRow.tsx`**

```tsx
'use client';
import type { CandidateCard } from '@/lib/server/search';
import type { Filters } from '@/lib/shared/filters';
import { cx } from '@/components/ui';

export function ResultRow({ candidate: c, filters, selected, onOpen, action }: {
  candidate: CandidateCard; filters: Filters; selected: boolean; onOpen: () => void; action?: React.ReactNode;
}) {
  const wanted = new Set([...(filters.skills ?? []), ...(filters.any_skills ?? [])]);
  const skills = [...c.skills].sort((a, b) => Number(wanted.has(b)) - Number(wanted.has(a))).slice(0, 4);
  return (
    <li className={cx('flex items-center gap-3 border-t border-line bg-surface px-4 py-3', selected && 'bg-accent-soft/50 shadow-[inset_2px_0_0_var(--accent)]')}>
      <button type="button" onClick={onOpen} aria-label={`Open ${c.full_name}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <img src={c.avatar_url} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-full bg-line" />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-medium">{c.full_name}</span>
            {c.open_to_work && <span className="rounded bg-accent-soft px-1.5 text-xs text-accent">Open to work</span>}
          </span>
          <span className="block truncate text-sm text-muted">{c.current_title} at {c.current_company} · {c.city}, {c.years_experience} yrs</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {skills.map((s) => (
              <span key={s} className={cx('rounded px-1.5 text-xs', wanted.has(s) ? 'bg-accent-soft font-medium text-accent' : 'bg-line text-muted')}>{s}</span>
            ))}
          </span>
        </span>
      </button>
      {action}
    </li>
  );
}
```

- [ ] **Step 3: Replace `app/(app)/page.tsx`**

```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PlanBanner, useAppState } from '@/components/app-shell';
import { ChipBar } from '@/components/search/ChipBar';
import { ResultRow } from '@/components/search/ResultRow';
import { ErrorBar, FirstVisit, NoResults, RowSkeletons, SearchingSkeleton } from '@/components/search/states';
import { Button } from '@/components/ui';
import { ApiError, api } from '@/lib/client/api';
import type { CandidateCard, PageResponse, SearchResponse } from '@/lib/server/search';
import type { Filters } from '@/lib/shared/filters';

type Status = 'idle' | 'searching' | 'refining' | 'done' | 'error';

// The brief that produced a search, kept per tab so a restored search can still be saved. Storage may be blocked: ignore.
const rememberBrief = (id: string, brief: string) => { try { sessionStorage.setItem(`brief:${id}`, brief); } catch {} };
const readBrief = (id: string) => { try { return sessionStorage.getItem(`brief:${id}`) ?? ''; } catch { return ''; } };

export default function SearchPage() {
  return <Suspense><SearchView /></Suspense>;
}

function SearchView() {
  const { plan, refreshPlan, openUpgrade } = useAppState();
  const params = useSearchParams();
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [searchedBrief, setSearchedBrief] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [rows, setRows] = useState<CandidateCard[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastRequest = useRef<{ body: object; kind: 'searching' | 'refining' } | null>(null);
  const startedFromSaved = useRef(false);
  const restored = useRef<string | null>(null);
  const outOfSearches = plan?.plan === 'free' && plan.searches_remaining === 0;
  const savable = Boolean(searchedBrief && result && Object.keys(result.filters).length && !result.filters.unsupported);

  const run = useCallback(async (body: object, kind: 'searching' | 'refining', label: string) => {
    lastRequest.current = { body, kind };
    setStatus(kind); setError(null); setSaveState('idle');
    try {
      const r = await api<SearchResponse>('/api/search', { method: 'POST', body });
      setResult(r); setRows(r.results); setPage(1); setSearchedBrief(label); setStatus('done'); setMoreState('idle');
      // Keep the search in the URL: leaving the page or reloading brings it back, so a free user can still refine it.
      restored.current = r.search_id;
      rememberBrief(r.search_id, label);
      router.replace(`/?search=${r.search_id}`, { scroll: false });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402) { openUpgrade(); setStatus(result ? 'done' : 'idle'); }
      else { setError(err.message); setStatus('error'); }
    } finally {
      refreshPlan().catch(() => {});
    }
  }, [openUpgrade, refreshPlan, result, router]);

  // Restore /?search=<id> (after navigating away, or a reload). Paging never uses a search.
  useEffect(() => {
    const id = params.get('search');
    if (!id || restored.current === id) return;
    restored.current = id;
    setStatus('refining');
    api<PageResponse>(`/api/search/${id}?page=1`)
      .then((r) => {
        setResult({ search_id: id, filters: r.filters, total: r.total, results: r.results, searches_remaining: null });
        setRows(r.results); setPage(1); setSearchedBrief(readBrief(id)); setStatus('done');
      })
      .catch(() => { setStatus('idle'); router.replace('/'); });
  }, [params, router]);

  // Re-run a saved search: /?saved=<id>&brief=<text> (from the Saved searches page). Guarded for React StrictMode.
  useEffect(() => {
    const savedId = params.get('saved');
    if (!savedId || startedFromSaved.current) return;
    startedFromSaved.current = true;
    const savedBrief = params.get('brief') ?? '';
    setBrief(savedBrief);
    router.replace('/');
    run({ saved_brief_id: savedId }, 'searching', savedBrief);
  }, [params, router, run]);

  const search = () => { const text = brief.trim(); if (text) run({ brief: text }, 'searching', text); };
  const refine = (filters: Filters) => result && run({ parent_search_id: result.search_id, filters }, 'refining', searchedBrief);

  async function loadMore() {
    if (!result) return;
    setMoreState('loading');
    try {
      const r = await api<PageResponse>(`/api/search/${result.search_id}?page=${page + 1}`);
      setRows((prev) => [...prev, ...r.results]); setPage(page + 1); setMoreState('idle');
    } catch { setMoreState('error'); }
  }

  async function save() {
    if (!result) return;
    setSaveState('saving');
    try { await api('/api/saved-briefs', { method: 'POST', body: { brief: searchedBrief, filters: result.filters } }); setSaveState('saved'); }
    catch { setSaveState('error'); }
  }

  return (
    <div className="flex items-start">
      <section className="min-w-0 flex-1 px-4 py-5 md:px-6">
        <PlanBanner />
        <form onSubmit={(e) => { e.preventDefault(); search(); }}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3 focus-within:border-accent">
          <label htmlFor="brief" className="sr-only">Describe who you&apos;re looking for</label>
          <input id="brief" value={brief} maxLength={500} onChange={(e) => setBrief(e.target.value)} disabled={outOfSearches}
            aria-describedby={outOfSearches ? 'brief-help' : undefined} placeholder="Describe who you're looking for…"
            className="min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted" />
          <Button type="submit" variant="primary" disabled={outOfSearches || status === 'searching' || !brief.trim()}>
            {status === 'searching' ? 'Searching…' : 'Search'}
          </Button>
        </form>
        {outOfSearches && <p id="brief-help" className="mt-1.5 text-sm text-muted">New searches need the paid plan. You can still change the filters of your last search.</p>}

        {status === 'idle' && !result && <FirstVisit onPick={setBrief} freeLeft={plan?.plan === 'free' ? plan.searches_remaining : null} />}
        {status === 'searching' && <SearchingSkeleton />}
        {status === 'refining' && !result && <RowSkeletons />}
        {status === 'error' && error && (
          <ErrorBar message={error} onRetry={lastRequest.current ? () => run(lastRequest.current!.body, lastRequest.current!.kind, searchedBrief || brief) : undefined} />
        )}

        {result && status !== 'searching' && (
          <div className="mt-4 space-y-3">
            <ChipBar filters={result.filters} onChange={refine} disabled={status === 'refining'} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted" aria-live="polite">
                {status === 'refining' ? 'Updating…' : `${result.total} ${result.total === 1 ? 'person matches' : 'people match'} all filters`}
              </span>
              {/* Only a search that can return people is worth saving: a re-run uses a search (FR-7.2). */}
              <Button onClick={save} disabled={!savable || saveState === 'saving' || saveState === 'saved'}>
                {saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Try saving again' : 'Save search'}
              </Button>
            </div>
            {status === 'refining' ? <RowSkeletons /> : rows.length > 0 ? (
              <>
                <ul className="-mx-4 overflow-hidden border-b border-line md:mx-0 md:rounded-xl md:border">
                  {rows.map((c) => (
                    <ResultRow key={c.id} candidate={c} filters={result.filters} selected={openId === c.id} onOpen={() => setOpenId(c.id)} />
                  ))}
                </ul>
                {moreState === 'loading' && <RowSkeletons rows={3} />}
                {rows.length < result.total && (
                  <Button onClick={loadMore} disabled={moreState === 'loading'} className="w-full">
                    {moreState === 'loading' ? 'Loading…' : moreState === 'error' ? 'Try again' : `Show more (${rows.length} of ${result.total})`}
                  </Button>
                )}
              </>
            ) : <NoResults filters={result.filters} onClear={() => refine({})} />}
          </div>
        )}
      </section>
      {/* Task 16 renders the profile panel here when openId is set. */}
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser (with `OPENAI_API_KEY` set)**

Fresh state: `npm run db:setup`, `npm run dev`, sign in as acme.
Checklist:
1. First visit shows the prompt, three examples and "Free plan: 1 search included"; clicking an example **only fills** the box. After the free search the examples are hidden and a visible line under the box explains why it is disabled.
2. Search "senior React engineers in New York who have worked at a startup" → "Reading your brief…" + skeletons → chips **Seniority Senior · City New York · Skill React · Worked at a startup** and **21 people match all filters**; React is highlighted on each row.
3. The top bar now says **0 searches left**, and the **free-search banner** appears; the brief box is disabled with the helper line "New searches need the paid plan…".
4. Click the City chip → searchable list of 10 cities → pick Boston → the results update **without** using a search (still 0 left, no 402).
5. Remove chips until none are left → "There's nothing to search for yet."; Clear filters works. Go to Shortlists and back, then reload: the same search, chips and results come back (no search used) and can still be refined.
6. Type a brief like "product managers who speak Japanese" (set acme to paid first via `admin()` or SQL) → amber chip "speaks Japanese · not in our data"; removing it shows product managers.
7. Show more loads the next 20; Save search → "Saved".
8. At 375 px: chips scroll sideways in one row; nothing overflows horizontally.
9. Dark mode: the tokens switch; contrast is readable.

- [ ] **Step 5: Commit**

```bash
git add components/search "app/(app)/page.tsx"
git commit -m "feat: search page with chips, states, paging and save"
```

---

### Task 16: Shortlist button and candidate profile

**Files:**
- Create: `components/ShortlistButton.tsx`, `components/ProfilePanel.tsx`
- Modify: `app/(app)/page.tsx` (render the button on rows and the panel)

**Interfaces:**
- Consumes: `useAppState().lists/refreshLists`, `api`.
- Produces: `<ShortlistButton candidateId name compact? block? />`, `<ProfilePanel id highlight onClose />`; `type Person` (the original candidate record).

- [ ] **Step 1: Write `components/ShortlistButton.tsx`**

```tsx
'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useAppState } from './app-shell';
import { Button, cx } from './ui';
import { api } from '@/lib/client/api';

export function ShortlistButton({ candidateId, name, compact, block }: { candidateId: string; name: string; compact?: boolean; block?: boolean }) {
  const { lists, refreshLists } = useAppState();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = (lists ?? []).some((l) => l.candidate_ids.includes(candidateId));

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await refreshLists(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (listId: string, member: boolean) =>
    act(() => api(`/api/shortlists/${listId}/people/${candidateId}`, { method: member ? 'DELETE' : 'POST' }));
  const createAndAdd = () => act(async () => {
    const { id } = await api<{ id: string }>('/api/shortlists', { method: 'POST', body: { name: newName } });
    await api(`/api/shortlists/${id}/people/${candidateId}`, { method: 'POST' });
    setNewName('');
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant={block ? 'primary' : on ? 'accent' : 'secondary'} aria-label={`${on ? 'Shortlisted' : 'Shortlist'} ${name}`}
          className={cx(block && 'w-full', compact && 'size-11 px-0 sm:size-auto sm:px-3')}>
          {on ? <Check size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
          <span className={cx(compact && 'sr-only sm:not-sr-only')}>{on ? 'Shortlisted' : 'Shortlist'}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="end" className="z-40 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <p className="px-2 pb-1 text-xs font-medium text-muted">Add {name} to</p>
          <ul>
            {(lists ?? []).map((l) => {
              const member = l.candidate_ids.includes(candidateId);
              return (
                <li key={l.id}>
                  <button type="button" disabled={busy} onClick={() => toggle(l.id, member)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg">
                    <span className="truncate">{l.name}</span>{member && <Check size={14} className="text-accent" />}
                  </button>
                </li>
              );
            })}
            {lists?.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No lists yet. Create one below.</li>}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createAndAdd(); }} className="mt-2 flex gap-1.5 border-t border-line pt-2">
            <label htmlFor={`new-list-${candidateId}`} className="sr-only">New list name</label>
            <input id={`new-list-${candidateId}`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="New list"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm" />
            <Button type="submit" disabled={busy || !newName.trim()}>Add</Button>
          </form>
          {error && <p role="alert" className="px-2 pt-2 text-sm text-danger">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 2: Write `components/ProfilePanel.tsx`**

```tsx
'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/client/api';
import { ShortlistButton } from './ShortlistButton';
import { Button, Skeleton, cx } from './ui';

export type Person = {
  id: string; full_name: string; avatar_url: string; headline: string; current_title: string;
  location: { city: string; state: string }; years_experience: number; open_to_work: boolean; skills: string[];
  experiences: { title: string; company: string; company_logo_url: string; company_type: string; start_year: number; end_year: number | null }[];
  education: { school: string; degree: string; field: string; graduation_year: number }[];
};

const PHONE = '(max-width: 767px)';
const usePhone = () => useSyncExternalStore(
  (onChange) => { const m = matchMedia(PHONE); m.addEventListener('change', onChange); return () => m.removeEventListener('change', onChange); },
  () => matchMedia(PHONE).matches,
  () => false,
);

/**
 * Desktop: docked beside the list, which stays usable (focus is not moved, Esc closes).
 * Phone: a full-screen modal dialog (Radix traps focus, closes on Esc, returns focus to the row) (DESIGN §4.1, §7).
 */
export function ProfilePanel({ id, highlight, onClose }: { id: string; highlight: Set<string>; onClose: () => void }) {
  const phone = usePhone();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPerson(null); setError(null);
    api<Person>(`/api/people/${id}`).then((p) => live && setPerson(p)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (phone) return; // Radix handles Esc on the phone dialog
    // defaultPrevented: Esc that only closed a popover inside the panel (Radix prevents it) must not close the panel too.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phone]);

  const body = (
    <>
      <div className="flex items-start justify-between">
        {person ? <img src={person.avatar_url} alt="" width={56} height={56} className="size-14 rounded-full bg-line" /> : <Skeleton className="size-14 rounded-full" />}
        <Button variant="quiet" aria-label="Close profile" onClick={onClose} className="min-w-11 px-1"><X size={20} /></Button>
      </div>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {!person && !error && <div className="mt-4 space-y-3" aria-busy="true"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-60" /><Skeleton className="h-24 w-full" /></div>}
      {person && (
        <>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">{person.full_name}</h2>
          <p className="text-muted">{person.current_title} · {person.location.city}, {person.years_experience} years</p>
          {person.open_to_work && <p className="mt-1 text-sm text-accent">Open to work</p>}
          <div className="mt-4"><ShortlistButton candidateId={person.id} name={person.full_name} block /></div>

          <h3 className="mt-6 text-sm font-medium text-muted">Experience</h3>
          {person.experiences.length === 0 ? <p className="mt-2 text-sm text-muted">No experience listed.</p> : (
            <ul className="mt-2 space-y-3">
              {person.experiences.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <img src={e.company_logo_url} alt="" width={24} height={24} className="mt-0.5 size-6 shrink-0 rounded-md bg-line" />
                  <div>
                    <p>{e.title}</p>
                    <p className="text-sm text-muted">{e.company}, {e.company_type}, {e.start_year} to {e.end_year ?? 'now'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-medium text-muted">Education</h3>
          {person.education.length === 0 ? <p className="mt-2 text-sm text-muted">No education listed.</p> : (
            <ul className="mt-2 space-y-2">
              {person.education.map((e, i) => (
                <li key={i}><p>{e.school}</p><p className="text-sm text-muted">{e.degree} {e.field}, {e.graduation_year}</p></li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-medium text-muted">Skills</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {person.skills.map((s) => (
              <span key={s} className={cx('rounded px-1.5 py-0.5 text-sm', highlight.has(s) ? 'bg-accent-soft font-medium text-accent' : 'bg-line text-muted')}>{s}</span>
            ))}
          </div>
        </>
      )}
    </>
  );

  if (phone) {
    return (
      <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-30 overflow-y-auto bg-surface p-5">
            <Dialog.Title className="sr-only">Candidate profile</Dialog.Title>
            {body}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <aside aria-label="Candidate profile"
      className="sticky top-14 h-[calc(100dvh-3.5rem)] w-[380px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5">
      {body}
    </aside>
  );
}
```

- [ ] **Step 3: Wire them into `app/(app)/page.tsx`**

Add imports:
```tsx
import { ProfilePanel } from '@/components/ProfilePanel';
import { ShortlistButton } from '@/components/ShortlistButton';
```
Pass the button to each row:
```tsx
<ResultRow key={c.id} candidate={c} filters={result.filters} selected={openId === c.id} onOpen={() => setOpenId(c.id)}
  action={<ShortlistButton candidateId={c.id} name={c.full_name} compact />} />
```
Replace the `{/* Task 16 … */}` comment with:
```tsx
{openId && result && (
  <ProfilePanel id={openId} onClose={() => setOpenId(null)}
    highlight={new Set([...(result.filters.skills ?? []), ...(result.filters.any_skills ?? [])])} />
)}
```

- [ ] **Step 4: Verify**

Checklist: every row has **+ Shortlist** (desktop) or a 44 px **+** (phone); the popover lists lists, creates "Frontend NYC" and adds the person; the row then shows **✓ Shortlisted**; clicking a name docks the profile on the right at 1280 px (the list stays clickable and keeps focus; clicking another person swaps the profile) and opens a full-screen dialog at 375 px (Tab stays inside it; closing returns focus to the row); Esc and × close it; Esc inside the Shortlist popover closes only the popover; experience shows logos, education and skills (matched ones highlighted).

- [ ] **Step 5: Commit**

```bash
git add components/ShortlistButton.tsx components/ProfilePanel.tsx "app/(app)/page.tsx"
git commit -m "feat: shortlist from results and profile; docked profile panel"
```

---

### Task 17: Shortlists and saved searches pages

**Files:**
- Create: `app/(app)/shortlists/page.tsx`, `app/(app)/shortlists/[id]/page.tsx`, `app/(app)/saved/page.tsx`, `components/ConfirmDialog.tsx`, `components/EmptyState.tsx`

**Interfaces:**
- Consumes: `api`, `useAppState`, `ResultRow`, `ProfilePanel`, `ShortlistButton`, `chipsOf`.

- [ ] **Step 1: Write `components/ConfirmDialog.tsx` and `components/EmptyState.tsx`**

`components/ConfirmDialog.tsx`:
```tsx
'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './ui';

/** In-app confirmation (never the browser's confirm()). */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onOpenChange }: {
  open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-2xl">
          <Dialog.Title className="font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">{body}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
            <Button variant="primary" onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`components/EmptyState.tsx`:
```tsx
export function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-8 max-w-xl">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      {children && <div className="mt-4 flex gap-2">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Write `app/(app)/shortlists/page.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';

export default function ShortlistsPage() {
  const { lists, refreshLists } = useAppState();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await refreshLists(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="px-4 py-5 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Shortlists</h1>
      <form onSubmit={(e) => { e.preventDefault(); act(async () => { await api('/api/shortlists', { method: 'POST', body: { name } }); setName(''); }); }}
        className="mt-4 flex max-w-md gap-2">
        <label htmlFor="new-list" className="sr-only">New list name</label>
        <input id="new-list" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New list name"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2" />
        <Button type="submit" variant="primary" disabled={!name.trim()}>New list</Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {lists === null && <div className="mt-6 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {lists?.length === 0 && (
        <EmptyState title="No shortlists yet." body="Shortlist someone from search results, or create an empty list to fill later.">
          <Link href="/" className={buttonClass('primary')}>Go to search</Link>
        </EmptyState>
      )}
      {lists && lists.length > 0 && (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          {lists.map((l) => (
            <li key={l.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
              {editing?.id === l.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); act(async () => { await api(`/api/shortlists/${l.id}`, { method: 'PATCH', body: { name: editing.name } }); setEditing(null); }); }}>
                  <label htmlFor={`rename-${l.id}`} className="sr-only">List name</label>
                  <input id={`rename-${l.id}`} autoFocus value={editing.name} maxLength={80} onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1" />
                  <Button type="submit" variant="primary">Save</Button>
                  <Button type="button" variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <Link href={`/shortlists/${l.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="text-sm text-muted">{l.count} {l.count === 1 ? 'person' : 'people'}</span>
                  </Link>
                  <Button variant="quiet" onClick={() => setEditing({ id: l.id, name: l.name })}>Rename</Button>
                  <Button variant="quiet" onClick={() => setDeleting({ id: l.id, name: l.name })}>Delete</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`} body="The list and its members are removed for everyone at your company." confirmLabel="Delete"
        onConfirm={() => { const d = deleting!; setDeleting(null); act(() => api(`/api/shortlists/${d.id}`, { method: 'DELETE' })); }} />
    </section>
  );
}
```

- [ ] **Step 3: Write `app/(app)/shortlists/[id]/page.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { EmptyState } from '@/components/EmptyState';
import { ProfilePanel } from '@/components/ProfilePanel';
import { ResultRow } from '@/components/search/ResultRow';
import { ErrorBar, RowSkeletons } from '@/components/search/states';
import { Button, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { CandidateCard } from '@/lib/server/search';

export default function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { refreshLists } = useAppState();
  const [list, setList] = useState<{ id: string; name: string; people: CandidateCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => api<{ id: string; name: string; people: CandidateCard[] }>(`/api/shortlists/${id}`).then(setList).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function remove(personId: string) {
    try { await api(`/api/shortlists/${id}/people/${personId}`, { method: 'DELETE' }); await Promise.all([load(), refreshLists()]); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="flex items-start">
      <section className="min-w-0 flex-1 px-4 py-5 md:px-6">
        <Link href="/shortlists" className="text-sm text-muted hover:text-ink">Shortlists</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{list?.name ?? ' '}</h1>
        {error && <ErrorBar message={error} />}
        {!list && !error && <RowSkeletons rows={4} />}
        {list?.people.length === 0 && (
          <EmptyState title="Nobody on this list yet." body="Shortlist people from search results.">
            <Link href="/" className={buttonClass('primary')}>Go to search</Link>
          </EmptyState>
        )}
        {list && list.people.length > 0 && (
          <ul className="mt-4 overflow-hidden border-y border-line md:rounded-xl md:border">
            {list.people.map((c) => (
              <ResultRow key={c.id} candidate={c} filters={{}} selected={openId === c.id} onOpen={() => setOpenId(c.id)}
                action={<Button onClick={() => remove(c.id)} aria-label={`Remove ${c.full_name} from this list`}>Remove</Button>} />
            ))}
          </ul>
        )}
      </section>
      {openId && <ProfilePanel id={openId} highlight={new Set()} onClose={() => setOpenId(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Write `app/(app)/saved/page.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { chipsOf } from '@/components/search/chip-model';
import { ErrorBar } from '@/components/search/states';
import { Button, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { Filters } from '@/lib/shared/filters';

type Saved = { id: string; brief: string; filters: Filters; created_at: string };

export default function SavedPage() {
  const router = useRouter();
  const { plan, openUpgrade } = useAppState();
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Saved | null>(null);
  const out = plan?.plan === 'free' && plan.searches_remaining === 0;

  const load = () => api<Saved[]>('/api/saved-briefs').then(setSaved).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <section className="px-4 py-5 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Saved searches</h1>
      <p className="mt-1 text-sm text-muted">Running a saved search uses a search on the free plan.</p>
      {error && <ErrorBar message={error} />}
      {saved === null && !error && <div className="mt-6 space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
      {saved?.length === 0 && (
        <EmptyState title="No saved searches yet." body="Run a search, then press Save search next to the results.">
          <Link href="/" className={buttonClass('primary')}>Go to search</Link>
        </EmptyState>
      )}
      {saved && saved.length > 0 && (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          {saved.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 border-t border-line px-4 py-3 first:border-t-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.brief}</p>
                <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                  {chipsOf(s.filters).map((c, i) => <span key={i} className="rounded bg-line px-1.5">{c.kind === 'unsupported' ? c.text : `${c.label} ${c.text}`.trim()}</span>)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => (out ? openUpgrade() : router.push(`/?saved=${s.id}&brief=${encodeURIComponent(s.brief)}`))}>Run</Button>
                <Button variant="quiet" onClick={() => setDeleting(s)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this saved search?" body={deleting?.brief ?? ''}
        confirmLabel="Delete" onConfirm={() => { const d = deleting!; setDeleting(null); api(`/api/saved-briefs/${d.id}`, { method: 'DELETE' }).then(load).catch((e) => setError(e.message)); }} />
    </section>
  );
}
```

- [ ] **Step 5: Verify**

Checklist: create, rename (duplicate name shows "You already have a list with that name."), and delete a list (the in-app dialog, never `confirm()`); open a list, remove a person, open a profile from the list; "No shortlists yet." and "Nobody on this list yet." empty states with **Go to search**; saved searches list their chips; **Run** goes to search and runs it (it uses a search; on 0 left it opens Upgrade instead); delete with confirmation; everything works at 375 px.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/shortlists" "app/(app)/saved" components/ConfirmDialog.tsx components/EmptyState.tsx
git commit -m "feat: shortlists and saved searches pages"
```

---

### Task 18: UI review pass (desktop, phone, dark, keyboard)

**Files:** whichever components the checklist finds wrong.

- [ ] **Step 1: Walk the five graded UI checks at 1280 px and 375 px, light and dark**

Use the DESIGN.md §1 table as the checklist: (1) chips visible and easy to correct; (2) loading, empty and error states (force an error by stopping `npm run dev` mid-session, or by sending a brief with the key unset); (3) search, results and shortlists on a phone; (4) plan limit and Upgrade clear; (5) shortlist and save obvious. Screenshot each state for the Loom.

At 375 px, measure tap targets in DevTools (select the element, read its box): every button, chip, chip ×, + Filter, Shortlist and nav item is **at least 44 × 44 px** (SCORING UI check 3). Reload in the middle of a refined search: it must come back with its chips. Let the session expire (or sign out in another tab) and click something: you land on sign-in, not an error.

- [ ] **Step 2: Keyboard and screen-reader basics**

Tab through the search page: brief → Search → each chip → its × → + Filter → Clear filters → Save search → each row → Shortlist. Visible focus everywhere; Esc closes popovers, dialogs and the profile; every icon-only button has an `aria-label`.

- [ ] **Step 3: Copy audit**

Search the UI code for em-dashes and en-dashes: `grep -rn "[—–]" app components` → no matches. Labels are consistent: "Shortlist", "Save search", "Upgrade".

- [ ] **Step 4: Design review with the user**

Share the screenshots; apply the feedback; re-run `npm test` (the API must still pass) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add -A app components
git commit -m "fix: UI review pass (phone, dark, keyboard, copy)"
```

---

## Requirements check (plan review, 2026-10-07)

An independent reviewer checked this phase against TECH_REQUIREMENTS, SCORING, SPEC, ARCHITECTURE and DESIGN. I verified each finding against those docs before accepting or rejecting it.

| Requirement | Where in this phase | Proof |
|---|---|---|
| UI 1: see the filters and correct them easily, also on the free plan after the one search | ChipBar (Task 14); search kept in the URL (Task 15) | Task 15 checklist 4–5 (incl. leave and reload) |
| UI 2: loading, empty and error states | `states.tsx`, paging skeleton | Task 15 checklist, Task 18 Step 1 |
| UI 3: works on a phone (no sideways scroll, taps ≥ 44 px, profile as a sheet) | 44 px phone sizes; profile is a real dialog on phones | Task 18 Step 1 measurement |
| UI 4: plan limit and Upgrade clear | PlanStatus, PlanBanner, UpgradeDialog, visible helper line | Task 13 + 15 checklists |
| UI 5: shortlist and save obvious | ShortlistButton on every row, Save search | Task 16 + 17 checklists |
| Security: only the URL and publishable key in the browser | `lib/client/supabase.ts` | Task 19 secret scan |
| DESIGN §7: focus visible, dialogs trap focus and close on Esc | CSS in layers; Radix dialogs | Task 18 Step 2 |

**Changed after review:** global CSS moved into layers so Tailwind classes win (round skeletons, no double focus ring); the current search lives in the URL so leaving or reloading doesn't lose it; 44 px tap targets on phones; build checks use `npm run build` (plain `next build` has no Supabase env); the phone profile is a Radix dialog; Esc in a popover no longer closes the profile; desktop focus no longer jumps; an expired session signs out; clearer copy for "nothing to search for"; examples hidden when no searches are left; visible helper text under the disabled box; skeleton rows while paging; links styled as buttons (no button inside a link); overlay colour is a token; "Free plan · 1 search left" matches DESIGN.

**Rejected:** making the remaining filter types addable from "+ Filter" (at most years, any-of skills, current company, current company type). They can still be edited or removed when the AI sets them, and the rubric asks that filters can be corrected easily, which the 11 addable types cover.

**Verdict:** ready to implement.
