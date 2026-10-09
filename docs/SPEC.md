# Specification: Functional and Non-Functional Requirements

**Status:** APPROVED 2026-10-07. Any change from here on goes through this document first, and is logged in [NOTES.md](NOTES.md).
Hard constraints from the brief are referenced by short IDs (T*, S*, R*, X*, B*, P*, D*).

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
- FR-2.3 The server validates the LLM output against the schema. Unknown keys and values move to `unsupported`; they are never dropped silently (see §4.2).
- FR-2.4 Postgres runs a parameterized query built from the validated filters and returns matches **ranked best first**.
- FR-2.5 The response follows the contract `{ search_id, filters, total, results[20], searches_remaining }`.
- FR-2.6 If no usable filter is left (vague or hostile brief), **or any condition is unsupported** (e.g. "speaks Japanese"), the search returns **0 results**, never the whole table or a broadened set. The UI explains why and suggests how to rephrase.
- FR-2.7 A search stores its **validated filters** (not its results) in `searches`. Paging re-runs the same query with a deterministic order: `ORDER BY open_to_work DESC, years_experience DESC, id ASC` (§4.0). The candidate data is static, so the order is stable.
- FR-2.8 `POST /api/search` also accepts optional fields: `{ brief, filters?, parent_search_id?, saved_brief_id? }`. Exactly one mode applies, and any other combination gets **400**:
  - Only `brief` (the contract and grader path): the LLM extracts the filters.
  - `filters` plus `parent_search_id` (a correction, FR-4): the LLM is skipped and the parent's brief is used.
  - `saved_brief_id` (a re-run, FR-7.2): the LLM is skipped and the saved filters are used.
  
  Extensions are additive only. This is how filter corrections work (FR-4).

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
- FR-4.5 Quota: a correction is free, but each root search allows at most **10 corrections** (`searches.corrections_used`, incremented with the same conditional-`UPDATE` pattern as FR-8.3; the 11th correction gets **429** "You've refined this search 10 times. Start a new search to keep going". 402 is reserved for "no free searches left", which is the Upgrade signal). Reason: the filters can be anything, so a free correction can be an unrelated search. The cap is the actual limit; inheriting the brief alone limits nothing (OQ-1).

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
- FR-9.4 Ordering: the latest applied event's `created` timestamp is stored per subscription. Older events are recorded but **do not change state**. **Tie (same `created` second):** a cancellation (`.deleted` / `canceled`) wins, because ending is final; otherwise the later arrival applies. (Event IDs are random, so they can't order events.)
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
- SEC-4 API routes use a **user-scoped Supabase client** (the bearer token is passed through), so RLS is the main defence and the API checks are a second layer. The service/secret key is used only in the webhook handler and for **reading candidates** (search, shortlist cards, profiles), always after the recruiter is checked. Recruiters have no direct access to `candidates`, so the free plan can't be skipped by querying Supabase directly (decided 2026-10-07). Quota changes go through `SECURITY DEFINER` RPCs (OQ-8).
- SEC-5 Secrets live only in server code (`import 'server-only'`), with no `NEXT_PUBLIC_*` secrets. Before submission we grep `.next/static` for key prefixes.
- SEC-6 Hostile briefs: the LLM output goes through a strict schema, then a whitelist / known-values check, then **parameterized SQL only** (no string-built SQL). The brief is never put into SQL. The system prompt treats the brief as data, and we limit the brief's length.
- SEC-6a **No unconstrained query, ever.** Before querying, filters are normalised: no-op filters are dropped (`min_years ≤ 0`, `max_years ≥ the data's maximum`, empty arrays, `unsupported`). If **zero** filters are left, the search function returns `total: 0, results: []` **without touching the candidates table**. This check sits inside the shared query function, so every caller, including searches, paging, corrections and saved re-runs, goes through it.
- SEC-7 Input validation (zod) on every route body and parameter. UUID/int checks on ids.
- SEC-8 Errors return generic messages, never stack traces or SQL.

### NFR-PERF Performance
- PERF-1 Paging p95 is **< 300 ms**: load the stored filters by `search_id`, then re-run the indexed candidate query (5k rows, about 10 ms) with `LIMIT/OFFSET`.
- PERF-2 A new search is **< 3 s** end to end. We use a fast, small model with a short prompt and structured output, the candidate query takes < 200 ms, and indexes are built for the filter fields (GIN on skills / companies arrays, trigram or normalized columns for text).
- PERF-3 Model timeout is **6 s**, with no retry. In testing, p95 was 1.86 s but the worst call was 3.8 s. Failing a slow call outright would cost accuracy points, while a rare slow success costs at most a little of the speed score. On timeout, the search fails cleanly and the quota is refunded.

### NFR-ACC Search accuracy
- ACC-1 Precision matters as much as recall. Filters are exact matches, **AND-ed** across fields. Skills are AND-ed within the field; other fields are OR-ed within the field only where the brief says so (§4.1).
- ACC-2 The ground truth is an exact filter (§4.0), so page-1 precision follows from the precision of the filter. The ordering is a simple, deterministic UX choice: open to work first, then most experienced.
- ACC-3 Accuracy is measured against `queries.json` with a local eval script (precision, recall, page-1 precision). It must not regress before submission.
- ACC-4 A condition the data cannot support becomes an "unsupported" chip and **empties the result**. It is never invented and never silently dropped. Removing the chip re-runs the search without it.

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

## 4. Search design (based on `candidates.json` and `queries.json`, 2026-10-07)

### 4.0 What the data tells us
- **Every field has a small, fixed set of values.** 13 roles · 4 seniorities · 10 US cities (one country) · 79 skills · 28 companies (16 startups, 12 enterprises; each company always has the same type) · 5 degrees · 14 fields of study · 13 schools · `open_to_work` boolean · years 0–15 · exactly 1 education entry · 1–4 jobs in the work history.
- **The data is internally consistent:** `current_title` = seniority prefix + `role`; `headline` starts with the title; the job with `end_year = null` is always at `current_company`.
- **Seniority maps exactly to years of experience:** junior 0–2, mid 3–5, senior 6–9, staff 10–15. Seniorities "lead" and "principal" don't exist in the data.
- **The ground truth is an exact boolean filter.** Every non-empty sample query (9 of 9) reproduces **exactly** (0 false positives, 0 false negatives) as an AND of exact-match conditions:

| Brief | Matching rule (verified) |
|---|---|
| senior React engineers in New York who have worked at a startup | `seniority=senior` ∧ `'React' ∈ skills` ∧ `city=New York` ∧ **any** job at a startup. *Not* `role = Frontend` (that gives 6 of 21); *not* current job only (19 of 21) |
| product designers in SF who are open to work | `role` ∧ `city` ∧ `open_to_work` |
| data scientists with a PhD | `role` ∧ `degree=PhD` |
| backend engineers in Austin who know Go and Kubernetes | `role` ∧ `city` ∧ both skills (**AND** within skills) |
| staff full stack engineers in Seattle | `seniority` ∧ `role` ∧ `city` |
| ML engineers who studied at Stanford | `role` ∧ `school` |
| account executives in Chicago with enterprise sales experience | `role` ∧ `city` ∧ the **skill** `Enterprise Sales` (*not* "has worked at an enterprise company", which gives 15 of 22) |
| junior frontend engineers in Boston who are open to work | `seniority` ∧ `role` ∧ `city` ∧ `open_to_work` |
| mobile engineers who know Swift | `role` ∧ skill |
| product managers who speak Japanese | **expected empty.** Languages aren't in the data, so the whole search returns nothing (it does **not** drop the condition and return all 411 PMs) |

**What this means for the design:**
1. **Filtering is an exact match, AND-ed across conditions.** No fuzzy, partial or "soft" matching, which would only add false positives.
2. **If any condition in the brief can't be met from the data, the result is empty.** It is shown as an "unsupported" chip. Removing that chip re-runs the search without it (a free correction). This gives the right score *and* good UX.
3. **Ranking barely affects the score.** If the filter is exact, every result is correct, so page-1 precision equals overall precision. We use a simple, deterministic order: `open_to_work DESC, years_experience DESC, id ASC`. All the effort goes into **getting the filters right**.
4. **A skill named before a role word is a skill, not a role:** "React engineers" means skill = React, with no role filter. A role filter applies only when the brief names one of the 13 roles (or a clear alias of one).

### 4.1 Filter schema (final shape; every value is checked against a fixed list)
```ts
{
  roles?:        Role[]            // the 13 role values; OR within (e.g. "frontend or full stack")
  seniorities?:  Seniority[]       // junior|mid|senior|staff; OR within ("senior or staff")
  skills?:       Skill[]           // the 79 skills; **AND** within ("knows Go and Kubernetes")
  cities?:       City[]            // the 10 cities; OR within. A state maps to its cities (California → SF + LA)
  min_years?:    0..15;  max_years?: 0..15
  open_to_work?: true
  worked_at_company_type?: "startup" | "enterprise"     // any job in the history
  current_company_type?:   "startup" | "enterprise"     // only the current job ("currently at a startup")
  companies?:    Company[]         // 28 values; any job in the history; OR within
  current_company?: Company[]      // only the current job
  degrees?:      Degree[]          // BS|BA|MS|MBA|PhD; OR within
  fields?:       Field[]           // the 14 fields of study; OR within
  schools?:      School[]          // the 13 schools; OR within
  unsupported?:  string[]          // conditions the data can't answer → force an empty result
}
```
The lists are **generated from the data at seed time** and used for the zod schema, for the model's structured-output schema (as enums) and for the UI chip editors. Nothing is hard-coded twice.

### 4.2 Stopping invented filters
- The model has to choose from **enums in its structured output**, so it can't return a value that isn't in the data. Values it can't map go into `unsupported`.
- The server checks everything again (zod with the same enums). An unknown key or value moves to `unsupported`; it is never dropped silently.
- `unsupported` is not empty → `total = 0`, and the chips explain why. No usable filters at all → `total = 0` (SEC-6a).
- Subjective words with no data behind them ("great", "talented", "rockstar") are **ignored** rather than treated as unsupported. Concrete conditions we can't check (language, visa, salary, remote, a city or company not in the data, "lead"/"principal") **are** unsupported. The prompt gives examples of both kinds, and we tune this with our own extra test briefs.
- Aliases are handled in the prompt: NYC/Manhattan → New York, SF/Bay Area → San Francisco, ML → Machine Learning Engineer, "full-stack" → Full Stack Engineer, "Postgres/PostgreSQL" → Postgres, "Stanford" → Stanford University, "masters" → MS, "PhD/doctorate" → PhD, "5+ years" → `min_years: 5`.

### 4.3 Query
One parameterized SQL function, `search_candidates(filters jsonb, limit, offset)`, used by search, paging, corrections and re-runs. Candidates are stored as columns (role, seniority, city, years, open_to_work) plus arrays (`skills text[]`, `companies text[]`, `company_types text[]`, `degrees`, `fields`, `schools`) and the current company and its type. Array conditions use `@>` (contains all) and `&&` (overlaps), with GIN indexes. That's 5k rows, so the query takes a few ms.

### 4.4 Billing findings (`stripe-events.json`)
- Five deliveries, and all five signatures check out against the **full** secret string (`whsec_…` included) using `HMAC-SHA256(secret, t + "." + payload)`. Each payload must be HMAC'd **byte for byte as received**, never re-serialised from parsed JSON.
- The repeat has the **same event id but a different signature `t`**, so de-duplication must use `event.id`, never the signature.
- The out-of-order pair is `globex_2` (updated, `active`, created …320), which arrives before `globex_1` (created, `incomplete`, created …260). Ordering must use **`event.created`**, not arrival order or the signature `t`. Per subscription, an event is applied only if its `created` is later than the last applied one.
- Event types seen: `customer.subscription.created`, `.updated` and `.deleted`. Statuses seen: `active`, `incomplete`, `canceled`.
- The file's expected end state is **acme = free** (subscribed, then cancelled) and **globex = paid**. This becomes a test.

## 5. Decisions (formerly open questions)

| # | Question | Decision |
|---|---|---|
| OQ-1 | Do filter edits and saved-search re-runs count as a new search against the free quota? | **Corrections are free; saved-search re-runs count.** A correction must reference a `parent_search_id` the company owns, so it refines a search that has already been paid for. Without this, a free user would hit a 402 the moment they tried to fix a chip, which fails the "correct them easily" UI check. The cost is bounded at **10 corrections per paid-for search** (FR-4.5). The README states this tradeoff: a free user can run up to 10 refined queries off their one search |
| OQ-2 | Refund the quota when a search fails (LLM timeout / 5xx)? | **Yes.** A search that returns 0 results still counts |
| OQ-3 | Which Stripe statuses count as "active"? | `active` and `trialing` count as paid; everything else counts as free. The sample uses `active`, `incomplete` (→ free) and `canceled` (§4.4). A `.deleted` event always means free |
| OQ-4 | Signature timestamp tolerance? | **No tolerance check** (events are replayed). Signatures are checked with HMAC-SHA256 using `node:crypto` (FR-9.1). The README states the tradeoff: replay protection comes from event-id dedup and ordering, not from the timestamp |
| OQ-5 | After a subscription ends, does the free search come back? | **No.** It is 1 search in total, for ever |
| OQ-6 | Duplicate shortlist names within one company? | Reject with 409 |
| OQ-7 | Maximum brief length? | 500 characters |
| OQ-8 | Quota reserve/refund: Postgres `SECURITY DEFINER` RPC, or service-role client in the API? | **RPC** (`reserve_search()` / `refund_search()`). It uses the caller's company from `current_company_id()`, so no secret key is needed for quota (the candidate read itself uses the server's key, SEC-4) |
| OQ-9 | LLM provider and model? | **Decided (2026-10-07): OpenAI `gpt-4.1-mini-2025-04-14`** (`OPENAI_API_KEY`), pinned snapshot, Chat Completions with **strict `json_schema`** (enums generated from the data), `temperature: 0`. Test over 50 calls: **50/50 exact**, 0 errors, p50 1.26 s, p95 1.86 s, max 3.8 s. All 6 hostile/unanswerable briefs → empty. Cost ≈ **$0.0004–0.0007 per search** (about 1,390 tokens in, of which 1,152 are served from OpenAI's prompt cache, and about 90 out). Rejected: Gemini 3.8 Flash (free tier 6–21 s plus 503s), Gemini Flash-Lite (3–5 of 10 exact), `gpt-5.4-mini` and `gpt-5-mini` (45/50: they add a "Frontend" role to "React engineers") |
| OQ-10 | UI library? | Tailwind + shadcn/ui (Radix) for accessible primitives. No heavy component kit |

## 6. Inputs needed before implementation
- ~~The data files~~: done and committed (§4.0, §4.4).
- An LLM key is set locally (`OPENAI_API_KEY`).
- Still to do on this machine before building: install Node 24 and `make`.

## 7. Sign-off
- [x] Functional requirements approved (2026-10-07)
- [x] Non-functional requirements approved (2026-10-07)
- [x] Open questions resolved (2026-10-07)
