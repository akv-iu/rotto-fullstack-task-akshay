# Architecture

**Status:** APPROVED 2026-10-07.

How the app is built: the layers, the data, every request flow, setup and testing. It consolidates the six design sections agreed on 2026-10-07. The reasons behind each choice are in [NOTES.md](NOTES.md), the requirements in [SPEC.md](SPEC.md), and the UI in [DESIGN.md](DESIGN.md).

## 1. Overview

```
Browser (Next.js pages, client-rendered)
  │  signs in with supabase-js (URL + publishable key only)
  │  every data call → our /api routes with  Authorization: Bearer <access token>
  ▼
Next.js route handlers (app/api/*)          thin: validate input → call lib/server → shape the response
  ▼
lib/server/*                                all logic; server-only
  ├─ supabase   two clients: as-the-recruiter (RLS applies) · admin (billing only)
  ├─ auth       token → recruiter + company
  ├─ llm        brief → filter JSON (OpenAI gpt-4.1-mini-2025-04-14)    ← only place the OpenAI key is used
  ├─ filters    schema, value checks, normalisation, "never everyone" guard
  ├─ search     new / correction / saved re-run / paging
  └─ billing    Stripe signature check → apply_billing_event()            ← only place the Supabase secret + Stripe secret are used
  ▼
Postgres (local Supabase in Docker)
  tables with RLS · SQL functions for search, quota and billing
```

**Rules that hold everywhere**
1. **The browser never talks to the database for data.** It only uses Supabase to sign in, and calls `/api` for everything else. Nothing on the server calls our own API.
2. **API files are thin.** All logic is in `lib/server`, so it lives in one readable place.
3. **Three secrets, two files:** `OPENAI_API_KEY` → `llm`; `STRIPE_WEBHOOK_SECRET` → `billing`; `SUPABASE_SECRET_KEY` → `supabase` (`adminClient()`, used by `billing` and for candidate reads in `search` / `lists`). Both modules import `server-only`, so the build fails if anything tries to ship them to the browser.
4. **The company always comes from the token**, never from the request.
5. **The database enforces company separation itself** (RLS plus constraints). The API checks are a second layer, not the only one.

## 2. Repository layout

```
Makefile                      setup · dev · test (thin: calls npm / supabase / node scripts)
package.json                  engines: node 24 · devDependency supabase@2.119.0 (pinned CLI)
supabase/
  config.toml
  migrations/                 tables, RLS, grants, SQL functions (data layer)
scripts/
  setup-data.mjs              create the two recruiters, load candidates.json, build the allowed-value lists
  supabase-env.mjs            reads `supabase status -o json` → env vars for Next.js (dev.mjs, with-env.mjs use it)
lib/
  server/                     supabase.ts · auth.ts · llm.ts · filters.ts · search.ts · billing.ts · http.ts
  shared/
    filters.ts                filter types + zod schema (used by server and UI)
    vocab.ts                  GENERATED at setup from candidates.json (gitignored)
app/
  api/                        route handlers (contract + our extensions)
  sign-in/                    the only public page
  (app)/                      layout with the one sign-in guard; search · shortlists · saved pages
components/                   UI components
tests/                        grader-style checks (see §9)
.github/workflows/ci.yml      clean-clone setup + tests on every push
```

## 3. Configuration

| Variable | Set by | Used in | Browser? |
|---|---|---|---|
| `OPENAI_API_KEY` | the grader's shell | `lib/server/llm` | never |
| `STRIPE_WEBHOOK_SECRET` | the grader's shell | `lib/server/billing` | never |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | `make dev`, from `supabase status` | `lib/server/supabase` | never |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `make dev`, from `supabase status` | sign-in only | yes (public by design) |

There are **no `.env` files**: the graders' machine won't have one. A **missing OpenAI key doesn't stop the app**: search returns **503** before any quota is touched. A **missing Stripe secret** makes the webhook return **500** and change nothing. Everything else keeps working (TECH S6/S7).

## 4. Data model

### 4.1 Tables

| Table | Key columns | Recruiter access (via RLS / grants) |
|---|---|---|
| `candidates` | `id` (`cand_0001`), `full_name`, `avatar_url`, `headline`, `current_title`, `current_company`, `current_company_logo_url`, `role`, `seniority`, `years_experience`, `city`, `state`, `open_to_work`, **arrays** `skills`, `companies`, `company_types`, `degrees`, `fields`, `schools`, plus `current_company_type`, and `profile jsonb` (the original record, for the profile page) | **none** for recruiters: the server reads them with its own key after checking the recruiter, so the free plan can't be skipped by querying Supabase directly (decided 2026-10-07); no writes |
| `companies` | `id`, `slug` (`acme`/`globex`), `plan` (`free`/`paid`), `searches_used` | **read own row**; no writes |
| `recruiters` | `user_id` (auth user), `company_id` | **read own row**; no writes |
| `searches` | `id`, `company_id`, `brief`, `filters jsonb`, `status` (`pending`/`ready`/`refunded`), `root_id` (null for an original search), `corrections_used`, `created_at` | **read own company's**; **no direct writes** (only through the functions in §4.3) |
| `shortlists` | `id`, `company_id`, `name` (unique per company), `created_at`; **unique (`id`, `company_id`)** | full CRUD on own company's rows |
| `shortlist_members` | `shortlist_id`, `company_id`, `candidate_id`, `added_at`; PK (`shortlist_id`, `candidate_id`); **FK (`shortlist_id`, `company_id`) → `shortlists(id, company_id)` on delete cascade**; FK `candidate_id` → `candidates` | insert/delete/select on own company's rows |
| `saved_briefs` | `id`, `company_id`, `brief`, `filters jsonb`, `created_at` | insert/select/delete own company's rows |
| `subscriptions` | `stripe_subscription_id`, `company_id`, `status`, `last_event_created`, `last_event_type` | **none** |
| `billing_events` | `event_id` (PK), `received_at` | **none** |

Indexes: GIN on `skills`, `companies`, `company_types`, `degrees`, `fields`, `schools`; btree on `role`, `seniority`, `city`, `years_experience`. At 5k rows each query takes a few milliseconds; the speed test verifies it.

### 4.2 The four locks that keep companies apart
1. **A company stamp plus RLS** on every company-owned table: `company_id = (select public.current_company_id())`. The helper is `security definer`, `set search_path = ''`, and reads `recruiters` by `auth.uid()`. The sub-select makes it run once per query, not once per row.
2. **A list member references (list, company) together**, so the database rejects a member pointing at another company's list, whoever asks.
3. **Privileged tables can't be written directly** (`companies`, `recruiters`, `searches`, `subscriptions`, `billing_events`). They change only through the functions below.
4. **Supabase's default grants are revoked first.** `anon` gets nothing at all; `authenticated` gets back only what the table above lists.

### 4.3 SQL functions

| Function | Security | Callable by | Does |
|---|---|---|---|
| `current_company_id()` | definer | authenticated | The caller's company |
| `search_candidates(filters jsonb, lim int, off int)` | **invoker** | **service_role only** (the server calls it after checking the recruiter and the search) | The one fixed, parameterized query: exact match, AND across fields; order `open_to_work desc, years_experience desc, id asc`; returns rows + `total`. **Returns nothing if no real condition is present** (a second "never everyone" guard, after the one in `lib/server/filters`) |
| `reserve_search(brief text)` | definer | authenticated | **In one statement:** take the free search (`… where plan = 'paid' or searches_used < 1`). If granted, insert a `searches` row with `status = 'pending'` and return its id. If not → return null (→ 402) |
| `complete_search(search_id, filters jsonb)` | definer | authenticated | `pending` → `ready`, storing the cleaned filters. Own company only |
| `refund_search(search_id)` | definer | authenticated | **Only a `pending` search** of the caller's company: give the free search back, mark it `refunded` |
| `create_correction(parent_id, filters jsonb)` | definer | authenticated | Find the root of `parent_id` (own company and `ready`, otherwise not found); if `corrections_used < 10`, increment it and insert a `ready` search with `root_id`. Otherwise return "cap reached" (→ 429). **No quota** |
| `apply_billing_event(event_id, created, type, sub_id, company_slug, status)` | definer | **service_role only** | One transaction: dedup → ordering → update the subscription → recompute `companies.plan` (§7) |

**Why searches have a status:** if `refund_search` could refund *any* search, a recruiter could call it directly through Supabase after every search and never run out of free searches. With the status, only a search that's still **pending** (reserved, but the AI call hasn't finished) can be refunded, and once it's `ready` it can never be refunded. Calling these functions directly gains nothing: reserving still costs a search, and corrections are still capped at 10.

**Defence in depth on filters:** stored filters are **re-validated in `lib/server/filters` every time they're read** (paging, re-runs), so even a row written by calling a function directly can't make the API run an unchecked query.

## 5. Search

### 5.1 The filter shape (`lib/shared/filters.ts`)
```ts
{
  roles?, seniorities?, cities?, companies?, current_companies?, degrees?, fields?, schools?: string[]  // OR within each list
  skills?: string[]          // must have ALL
  any_skills?: string[]      // must have AT LEAST ONE ("React or Vue")
  min_years?, max_years?: number            // 0–15
  open_to_work?: true
  worked_at_company_type?, current_company_type?: "startup" | "enterprise"
  unsupported?: { text: string, reason: "unsupported" | "unclear" }[]   // non-empty → zero results
}
```
Every list value must be in the **allowed values** (`lib/shared/vocab.ts`, generated at setup from `candidates.json`). The same lists feed the model's JSON schema (as enums), the zod check, and the UI's chip menus.

### 5.2 The LLM call (`lib/server/llm`)
- **Model:** `gpt-4.1-mini-2025-04-14` through Chat Completions, `temperature: 0`, **strict `json_schema`** with enums from the vocabulary, **6 s timeout, no retry**, **one call per new search**.
- **Input:** the system prompt (rules, nickname mappings, our own worked examples) plus the brief wrapped in `<brief>…</brief>` and marked as untrusted. **Never** candidate data, counts, or the sample briefs as examples.
- Prompt changes are kept **only if the accuracy test improves or holds**, and latency is re-measured each time.

### 5.3 Cleaning (`lib/server/filters`)
zod parse → unknown keys or values move to `unsupported` → drop filters that do nothing (`min_years ≤ 0`, `max_years ≥ 15`, empty lists) → result: `{ filters, runnable }`, where `runnable` is false if `unsupported` is non-empty or no real condition is left.

### 5.4 Flows

**New search** — `POST /api/search { brief }`
```
auth (401) → brief 1–500 chars (400) → OpenAI key present? (503)
→ reserve_search(brief)                null → 402
→ llm(brief)                           fail/timeout → refund_search → 502
→ clean → complete_search(id, filters) fail → refund_search → 502
→ runnable ? search_candidates(filters, 20, 0) : empty
→ 200 { search_id, filters, total, results, searches_remaining }
```

**Correction** — `POST /api/search { filters, parent_search_id }`: no AI, no quota. Clean the incoming filters exactly as above → `create_correction` (unknown parent → 404, cap → 429) → page 1. The brief is inherited from the parent.

**Saved re-run** — `POST /api/search { saved_brief_id }`: load the saved filters (own company, otherwise 404) → re-clean → `reserve_search` (402) → `complete_search` → page 1. No AI.

Any other combination of fields → 400.

**Paging** — `GET /api/search/{id}?page=N`: page an integer ≥ 1 (400) → load the search (own company, `ready`; otherwise 404) → re-clean the stored filters → `search_candidates(filters, 20, (N−1)×20)` → `{ search_id, page, filters, total, results }`. A page past the end returns an empty `results`. **Never counts as a search.**

**Result items** contain the card fields: `id`, `full_name`, `avatar_url`, `current_title`, `current_company`, `city`, `years_experience`, `open_to_work`, `skills`.

## 6. Shortlists, saved searches, people

| Route | Notes |
|---|---|
| `GET /api/shortlists` | `[{ id, name, count, candidate_ids }]` (the IDs drive the "Shortlisted" state on result cards) |
| `POST /api/shortlists { name }` | **200** `{ id }`; name trimmed to 1–80 chars (400); duplicate in the company → 409 |
| `GET / PATCH / DELETE /api/shortlists/{id}` *(ours)* | detail with member cards · rename (400/409) · delete (cascades) |
| `POST /api/shortlists/{id}/people/{person_id}` | idempotent add (`on conflict do nothing`) → 200 either way; unknown list/person → 404 |
| `DELETE /api/shortlists/{id}/people/{person_id}` | idempotent remove → 200 |
| `GET /api/saved-briefs` | newest first `[{ id, brief, filters, created_at }]` |
| `POST /api/saved-briefs { brief, filters }` | filters cleaned before saving → **200** `{ id }` |
| `DELETE /api/saved-briefs/{id}` *(ours)* | own company only |
| `GET /api/people/{id}` | the full profile; malformed ID (`^cand_\d{4}$`) → 400, unknown → 404 |
| `GET /api/plan` | `{ plan, searches_remaining }`: paid → `null`; free → `max(0, 1 − searches_used)` |

**"Not yours" and "doesn't exist" both return 404.** Errors are `{ error: "<plain message>" }`, with no stack traces or SQL.

## 7. Billing — `POST /api/billing/events`

```
raw = await request.text()                       (exact bytes; never re-serialised)
STRIPE_WEBHOOK_SECRET missing → 500, no change
parse Stripe-Signature t=…, v1=…;  expected = HMAC-SHA256(secret, `${t}.${raw}`)
any v1 matches (timing-safe)? no → 400, no change          (no timestamp tolerance)
event = JSON.parse(raw)
type not customer.subscription.* → 200 (ignored)
company = data.object.metadata.company ∉ {acme, globex} → 200 (ignored)
apply_billing_event(...)  — one transaction, run with the admin client:
   insert billing_events(event_id) on conflict do nothing;  repeat → return
   cur = subscriptions row for this stripe subscription
   older (created < cur.last_event_created) → return
   tie (same second) → a cancellation wins; otherwise the later arrival applies
   upsert subscription(status, last_event_created, last_event_type)
   companies.plan = 'paid' if any of its subscriptions is active/trialing (and not deleted) else 'free'
→ 200
```
Searches always count toward `searches_used`, including on the paid plan ("1 search **in total**").

## 8. Frontend

- **Next.js 16 App Router.** Pages are client components that fetch `/api` with the token; there is **one sign-in guard** in `app/(app)/layout.tsx` that shows a skeleton until the session is known, then renders the page or redirects to `/sign-in`.
- **Styling:** Tailwind v4 with CSS-variable tokens for light and dark (the colour table in DESIGN §5); Montserrat via `next/font`; Phosphor icons.
- **Accessible primitives** (menus, dialogs, sheets) from Radix, styled to our tokens. No other component kit.
- **Images:** candidate photos and company logos load with a **plain `<img>`**, never `next/image` optimisation (the image host blocks server-side fetches).
- Screens, behaviours and states are as specified in [DESIGN.md](DESIGN.md).

## 9. Setup, dev and tests

### 9.1 `make setup` (idempotent, no prompts)
```
npm ci
npx supabase start                         (Docker; pinned CLI 2.119.0)
npx supabase db reset                      (fresh DB: all migrations, seeds the 2 companies)
node scripts/setup-data.mjs                (via the admin API: create both recruiters + link them to companies;
                                            load all 5,000 candidates; write lib/shared/vocab.ts)
```
### 9.2 `make dev`
`node scripts/dev.mjs` reads the Supabase values from `supabase status` (via `scripts/supabase-env.mjs`), then runs `next dev -p 3000` with the grader's `OPENAI_API_KEY` / `STRIPE_WEBHOOK_SECRET` passed through.

### 9.3 `make test` (each mirrors a graded area)
| Check | Proves |
|---|---|
| `accuracy` | the 10 samples plus our own typo / vague / "worst" / "or" / hostile briefs; precision, recall, page-1 precision; latency |
| `isolation` | as acme: every API route and **every table and function directly via Supabase** against globex data → denied; anon → nothing; recruiter can't change plan or quota or refund a finished search |
| `billing` | sample replay → acme free, globex paid (`/api/plan` after each); tampered / wrong secret / missing header → 400; concurrent duplicate; re-signed with another secret |
| `quota` | 20 concurrent searches on a fresh company → exactly 1 × 200; paging never 402s |
| `speed` | paging p95 < 150 ms, new search p95 < 2 s (locally) |
| `secrets` | after `next build`, grep `.next/` for key values and prefixes → none |
| unit | signature check, filter cleaning |

### 9.4 CI
GitHub Actions on Ubuntu, on every push: clean checkout → `make setup` → start the app → `make test` (with the accuracy test using an `OPENAI_API_KEY` repository secret, skipped if absent).

## 10. Known limits (stated in the README)
- No signature-timestamp tolerance: replay protection comes from event-ID dedup and ordering.
- Free corrections are capped at 10 per paid-for search.
- Allowed values are built at setup (fixed data); a growing product would read them from the database.
- Paging re-runs the query rather than storing results (cheap at 5k rows).
- If the process crashes between reserving a search and completing it, the reservation stays `pending` and that free search is lost.
