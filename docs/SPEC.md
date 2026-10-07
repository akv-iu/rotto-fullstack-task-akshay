# Specification: Functional and Non-Functional Requirements

**Status:** DRAFT, awaiting sign-off. No implementation starts until this is approved.
Hard constraints from the brief live in [TECH_REQUIREMENTS.md](TECH_REQUIREMENTS.md) and are referenced by their IDs (T*, S*, R*, X*, B*, P*, D*).

---

## 1. Actors

| Actor | Description |
|---|---|
| Recruiter | A signed-in user who belongs to exactly one company (`acme` or `globex`) |
| Stripe | An external system that POSTs signed webhook events. It has no user identity |
| Grader script | Calls the API and Supabase directly with a recruiter token, including hostile requests |

## 2. Functional requirements

### FR-1 Authentication
- FR-1.1 Recruiters sign in with email and password (Supabase Auth). There is no sign-up or password reset.
- FR-1.2 Recruiters can sign out.
- FR-1.3 Every page except sign-in requires a session. Unauthenticated API calls get **401**.
- FR-1.4 The API identifies the recruiter and their company **only** from the bearer token, never from a request body or parameter.

### FR-2 Natural-language search
- FR-2.1 The recruiter enters a free-text brief (max length to be set, see OQ-7).
- FR-2.2 The server sends **only the brief** to the LLM, which returns filters that must fit a fixed, typed filter schema (see §4).
- FR-2.3 The server validates the LLM output against the schema. Unknown fields, bad types and values the data cannot support are dropped (see §4.2).
- FR-2.4 Postgres runs a parameterized query built from the validated filters and returns matches **ranked best first**.
- FR-2.5 The response follows the contract `{ search_id, filters, total, results[20], searches_remaining }`.
- FR-2.6 If no usable filter is left (vague, unsupported or hostile brief), the search returns **0 results**, never the whole table. The UI explains why and suggests how to rephrase.
- FR-2.7 A search stores its **validated filters** (not its results) in `searches`. Paging re-runs the same query with a deterministic order: `ORDER BY score DESC, id ASC`. The candidate data is static, so the order is stable.
- FR-2.8 `POST /api/search` also accepts optional fields: `{ brief, filters?, parent_search_id?, saved_brief_id? }`. Exactly one mode applies, and any other combination gets **400**:
  - Only `brief` (the contract and grader path): the LLM extracts the filters.
  - `filters` plus `parent_search_id` (a correction, FR-4): the LLM is skipped and the parent's brief is used.
  - `saved_brief_id` (a re-run, FR-7.2): the LLM is skipped and the saved filters are used.
  
  Extensions are listed in TECH_REQUIREMENTS §3a. This is how filter corrections work (FR-4).

### FR-3 Paging
- FR-3.1 `GET /api/search/{id}?page=N` returns 20 results per page, 1-based.
- FR-3.2 Every result appears exactly once across all pages, and the order is the same as on page 1. This is guaranteed by the `id ASC` tiebreak with `LIMIT 20 OFFSET (N-1)*20`.
- FR-3.3 Paging never consumes quota.
- FR-3.4 A search belongs to its company. Another company's `search_id` gets **404**.
- FR-3.5 The UI offers paging or "load more" and shows the total count.

### FR-4 Filter review and correction
- FR-4.1 Every filter the app understood is shown as an editable chip (e.g. `Location: New York`, `Skill: React`, `≥ 5 yrs`, `Worked at: startup`).
- FR-4.2 The recruiter can remove a chip, edit its value, or add a filter, and the search re-runs **without calling the LLM** and without retyping the brief.
- FR-4.3 Edited filters from the client are untrusted. They go through the same zod schema and vocabulary check as LLM output (§4.2).
- FR-4.4 A correction sends `{ filters, parent_search_id }`. The parent must belong to the recruiter's company (otherwise **404**). The **brief is inherited from the parent**, and any brief in the request is ignored. The correction returns a new `search_id` whose parent is the **root** search (a chain of corrections never creates new roots).
- FR-4.5 Quota: a correction is free, but each root search allows at most **10 corrections** (`searches.corrections_used`, incremented with the same conditional-`UPDATE` pattern as FR-8.3; the 11th correction gets **402**). Reason: the filters can be anything, so a free correction can be an unrelated search. The cap is the actual limit; inheriting the brief alone limits nothing (OQ-1).

### FR-5 Candidate profile
- FR-5.1 `GET /api/people/{id}` and a profile view show name, portrait, headline, location, years of experience, skills, work history (with company logos) and education. The brief requires **experience, education and skills** (F3). If an entry has no education or work history, it shows an empty state rather than being hidden.
- FR-5.2 An unknown id returns **404**. A malformed id returns **400**.
- FR-5.3 Shortlist actions are available directly from the profile.

### FR-6 Shortlists (company-scoped)
- FR-6.1 List, create, rename and delete named shortlists. All recruiters of the same company share them.
- FR-6.2 Add and remove candidates. Adding one who is already on the list does nothing and returns success (**idempotent**).
- FR-6.3 Shortlisting is one tap from both search results and the profile. A candidate already on a list shows that state.
- FR-6.4 Names are validated (non-empty, trimmed, max length). Duplicate names: see **OQ-6**.
- FR-6.5 Another company's shortlist id gets **404**, whether reading or writing.
- FR-6.6 Deleting a list asks for in-app confirmation (not a browser `confirm()` dialog) and also removes its memberships (cascade).
- Note: the contract lists only GET/POST for shortlists and POST/DELETE for members. Rename and delete need extra routes (`PATCH` and `DELETE /api/shortlists/{id}`), and the UI needs a list detail route (`GET /api/shortlists/{id}`).

### FR-7 Saved searches (company-scoped)
- FR-7.1 Save the current brief together with its current (possibly edited) filters, using `{ brief, filters }`.
- FR-7.2 List saved searches, and re-run one **without calling the LLM** by sending `POST /api/search` with `{ saved_brief_id }`. The server loads that saved search's stored filters, which must belong to the company (otherwise **404**). Filters from the client are never accepted for a re-run. A re-run is a new search, so it **uses quota** (OQ-1).
- FR-7.3 Delete a saved search (extra route, not in the contract).
- FR-7.4 Stored filters are validated again when they are re-run (the schema may have changed and the client cannot be trusted).

### FR-8 Plan and quota
- FR-8.1 `GET /api/plan` returns `{ plan, searches_remaining }`, where `searches_remaining` is `null` on the paid plan.
- FR-8.2 Free plan: **1 search in total** per company. The 2nd attempt gets **402** with a clear message.
- FR-8.3 **Reserve first.** Before calling the LLM, a single auto-committed statement runs: `UPDATE companies SET searches_used = searches_used + 1 WHERE id = $1 AND (plan = 'paid' OR searches_used < 1) RETURNING …`. If it updates 0 rows, the request returns **402** immediately. No transaction or lock is held while the LLM runs. Under N concurrent requests exactly one wins, and the rest get a fast 402 without spending an LLM call.
- FR-8.4 If the LLM or DB step fails after the reservation, a compensating `UPDATE` **refunds** it (OQ-2). Ceiling: if the process crashes between the two statements, one search is lost. That is acceptable.
- FR-8.5 The UI always shows the plan and the searches remaining. When the quota is used up, the search box explains this and shows **Upgrade**.
- FR-8.6 **Upgrade** opens an explanation (subscribe through Stripe, and the plan updates automatically when the webhook arrives). No checkout.

### FR-9 Stripe billing webhook
- FR-9.1 `POST /api/billing/events` reads the **raw body** and verifies `Stripe-Signature` (`t=…,v1=…`, HMAC-SHA256 of `${t}.${body}`, constant-time compare, any matching `v1`). If verification fails, it returns **400** and changes nothing. It is implemented with `node:crypto` (about 15 lines), with no Stripe SDK, so no default 300 s tolerance can silently reject replayed events.
- FR-9.2 Timestamp tolerance: **not enforced, or very wide** (see OQ-4). The sample events are signed in the past, and the graders may replay old events.
- FR-9.3 Idempotency, with no check-then-act: after the signature is verified, the handler calls one RPC, `apply_billing_event(...)`, that runs in **one transaction**. It first runs `INSERT INTO billing_events (id, …) ON CONFLICT DO NOTHING`. If no row is inserted, the event is a repeat, so it returns and the endpoint responds **200**. Otherwise it applies the FR-9.4 conditional upsert. If applying fails, the dedup row rolls back with it, so Stripe's retry can still be processed and no event is lost. A concurrent duplicate blocks on the unique index until the first commits, then sees the conflict.
- FR-9.4 Ordering: the latest applied event's `created` timestamp (plus the event id as a tiebreak) is stored per subscription. Older events are recorded but **do not change state**.
- FR-9.5 The company is resolved from `data.object.metadata.company`. If it is missing or unknown, the event returns **200** and is ignored (logged).
- FR-9.6 A company is **paid** when it has at least one subscription whose latest known status counts as active (status mapping: see OQ-3). `customer.subscription.deleted` (or a canceled status) drops it back to **free**.
- FR-9.7 Event types we don't handle return **200** and are ignored.
- FR-9.8 When a company drops back to free, its used searches stay used (it does not get a new free search). See OQ-5.

### FR-10 UI screens (minimal set)
1. **Sign in**
2. **Search**: brief input, filter chips, results list (avatar, name, headline, location, years, top skills, shortlist button), paging, total, plan badge / searches remaining, and a "Save search" action
3. **Candidate profile**: a page, or a sheet on mobile
4. **Shortlists**: lists with create / rename / delete, and a list detail with members and remove
5. **Saved searches**: list, re-run, delete
6. **Upgrade dialog**

Every data view has explicit **loading** (skeletons), **empty** (with a next action) and **error** (with a retry) states.

## 3. Non-functional requirements

### NFR-SEC Security
- SEC-1 **RLS on every table.** Tenant tables (`shortlists`, `shortlist_members`, `saved_briefs`, `searches`) can only be read and written where `company_id = current recruiter's company`. The company comes from this helper:
  ```sql
  create function public.current_company_id() returns uuid
  language sql stable security definer set search_path = ''
  as $$ select company_id from public.recruiters where user_id = auth.uid() $$;
  ```
  Policies call it as `company_id = (select public.current_company_id())`. The sub-select makes Postgres evaluate it once per query, not once per row. `EXECUTE` is revoked from `anon`.
- SEC-2 **Privileged tables are read-only or invisible to `authenticated`:** `companies` / plan, quota counters, `subscriptions`, `billing_events` and `recruiters` (read own row only). Otherwise a recruiter could grant themselves the paid plan or reset their quota through PostgREST.
- SEC-3 Candidates are readable by `authenticated` only, and never writable by them.
- SEC-4 API routes use a **user-scoped Supabase client** (the bearer token is passed through), so RLS is the main defence and the API checks are a second layer. The service/secret key is used **only in the webhook handler**. Quota changes go through `SECURITY DEFINER` RPCs (OQ-8).
- SEC-5 Secrets live only in server code (`import 'server-only'`), with no `NEXT_PUBLIC_*` secrets. Before submission we grep `.next/static` for key prefixes.
- SEC-6 Hostile briefs: the LLM output goes through a strict schema, then a whitelist / known-values check, then **parameterized SQL only** (no string-built SQL). The brief is never put into SQL. The system prompt treats the brief as data, and we limit the brief's length.
- SEC-6a **No unconstrained query, ever.** Before querying, filters are normalised: no-op filters are dropped (`min_years ≤ 0`, `max_years ≥ the data's maximum`, empty arrays, `unsupported`). If **zero** filters are left, the search function returns `total: 0, results: []` **without touching the candidates table**. This check sits inside the shared query function, so every caller, including searches, paging, corrections and saved re-runs, goes through it.
- SEC-7 Input validation (zod) on every route body and parameter. UUID/int checks on ids.
- SEC-8 Errors return generic messages, never stack traces or SQL.

### NFR-PERF Performance
- PERF-1 Paging p95 is **< 300 ms**: load the stored filters by `search_id`, then re-run the indexed candidate query (5k rows, about 10 ms) with `LIMIT/OFFSET`.
- PERF-2 A new search is **< 3 s** end to end. We use a fast, small model with a short prompt and structured output, the candidate query takes < 200 ms, and indexes are built for the filter fields (GIN on skills / companies arrays, trigram or normalized columns for text).
- PERF-3 The model call has a timeout of about 2.5 s. On timeout, the search fails cleanly and the quota is refunded.

### NFR-ACC Search accuracy
- ACC-1 Precision matters as much as recall. Filters are **AND-ed** across dimensions and OR-ed within one dimension only where the brief says so.
- ACC-2 Ranking puts the strongest matches on page 1 (e.g. how many soft criteria match, how relevant the title/headline is, years of experience). The scoring formula is decided after we profile the data.
- ACC-3 Accuracy is measured against `queries.json` with a local eval script (precision, recall, page-1 precision). It must not regress before submission.
- ACC-4 Brief terms the data cannot support produce an "unsupported" note shown to the user, **not** an invented filter.

### NFR-UX Product and design
- UX-1 Minimal, beautiful, and usable without instructions. Every element earns its place.
- UX-2 Mobile first: search, results and shortlists work fully at 375 px width.
- UX-3 Filter chips are always visible above the results and editable in place.
- UX-4 Plan status and the upgrade path are visible without searching for them.
- UX-5 Accessibility basics: keyboard navigable, labelled controls, sufficient contrast, reduced-motion respected.

### NFR-OPS Reproducibility and code quality
- OPS-1 `make setup` and `make dev` work on a clean macOS Apple Silicon machine (S1–S5). The Supabase CLI is pinned through npm, and Supabase URLs and keys are read from `supabase status` at runtime, not committed.
- OPS-2 `make setup` is idempotent: running it twice does not fail or duplicate data.
- OPS-3 Clear layering: `supabase/migrations` (data), `lib/server/*` (search, quota, billing, LLM), `app/api/*` (thin route handlers), and `app/(ui)` / components (UI).
- OPS-4 Small automated checks on the risky paths: signature verification, idempotency / out-of-order handling, quota concurrency, RLS cross-tenant denial, and the search eval script.

### NFR-DOC Documentation
- DOC-1 A one-page README (D2) and a Loom of 5 minutes or less (D3).

## 4. Search design (provisional, finalised after inspecting `candidates.json`)

### 4.1 Filter schema (draft)
```ts
{
  titles?: string[]          // role keywords: "frontend engineer", "data scientist"
  seniority?: "junior"|"mid"|"senior"|"staff"|"principal"|"lead"
  skills?: string[]          // must match the known skills vocabulary
  locations?: string[]       // must match known locations (city/state/country)
  min_years?: number; max_years?: number
  companies?: string[]       // worked at (known company names)
  company_traits?: ("startup"|...)[]  // only if the data can support it
  schools?: string[]; degrees?: string[]
  unsupported?: string[]     // parts of the brief we can't filter on (shown, not applied)
}
```

### 4.2 Stopping invented filters
- The vocabularies (skills, locations, companies, schools, degrees) are extracted from the data at seed time.
- The LLM receives the field list and enum-like guidance. Its output is **normalised and matched against the vocabularies** in Postgres. Values with no match move to `unsupported` instead of being applied.
- Synonyms and aliases (e.g. `NYC` → `New York`, `JS` → `JavaScript`) are handled by the prompt plus a small alias table.

## 5. Open questions (need your decision)

| # | Question | Proposed default |
|---|---|---|
| OQ-1 | Do filter edits and saved-search re-runs count as a new search against the free quota? | **Corrections are free; saved-search re-runs count.** A correction must reference a `parent_search_id` the company owns, so it refines a search that has already been paid for. Without this, a free user would hit a 402 the moment they tried to fix a chip, which fails the "correct them easily" UI check. The cost is bounded at **10 corrections per paid-for search** (FR-4.5). The README states this tradeoff: a free user can run up to 10 refined queries off their one search |
| OQ-2 | Refund the quota when a search fails (LLM timeout / 5xx)? | **Yes.** A search that returns 0 results still counts |
| OQ-3 | Which Stripe statuses count as "active"? | `active` and `trialing` count as paid. `past_due`, `unpaid`, `canceled`, `incomplete*` and `paused` count as free |
| OQ-4 | Signature timestamp tolerance? | **No tolerance check** (events are replayed). Signatures are checked with HMAC-SHA256 using `node:crypto` (FR-9.1). The README states the tradeoff: replay protection comes from event-id dedup and ordering, not from the timestamp || OQ-5 | After a subscription ends, does the free search come back? | **No.** It is 1 search in total, for ever |
| OQ-6 | Duplicate shortlist names within one company? | Reject with 409 |
| OQ-7 | Maximum brief length? | 500 characters |
| OQ-8 | Quota reserve/refund: Postgres `SECURITY DEFINER` RPC, or service-role client in the API? | **RPC** (`reserve_search()` / `refund_search()`). It uses the caller's company from `current_company_id()`, so no secret key is needed on the search path |
| OQ-9 | LLM provider and model? | A fast, cheap model with structured output (e.g. Claude Haiku 4.5, or a GPT-mini / Gemini Flash tier). We decide after a latency and accuracy check against `queries.json` |
| OQ-10 | UI library? | Tailwind + shadcn/ui (Radix) for accessible primitives. No heavy component kit |

## 6. Inputs needed before implementation
- `candidates.json`, `stripe-events.json` and `queries.json` placed in `data/` (to inspect the schema, the event types and the eval set).
- Node 24, `make` and an LLM key available locally.

## 7. Sign-off
- [ ] Functional requirements approved
- [ ] Non-functional requirements approved
- [ ] Open questions resolved
