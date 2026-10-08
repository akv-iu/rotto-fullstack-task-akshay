# The plan, explained

A plain-language guide to every file and function in the plan, phase by phase: what each one does, why it exists, and the questions where your judgement matters most. The code itself lives in the phase files; this page is for reviewing the thinking.

**How the app works, in one paragraph.** A recruiter types who they want ("senior React engineers in New York"). Our server sends only that sentence to the AI, which sends back a list of filters (role, city, skill…). We check every filter against the values that really exist in the data, then the database finds the matching people. The recruiter sees the filters as chips and can edit them; editing or paging never calls the AI again and never uses up a search. Each company's lists and saved searches are private to that company, and the database enforces this, not only our code.

---

## Phase 1: The gate (Tasks 1–3)

**What it establishes:** a fresh computer goes from "clone the repo" to "app running with 5,000 candidates" with two commands. Nothing is scored here, but if it fails the grader can't score anything else.

| Piece | What it does | Why |
|---|---|---|
| `package.json` scripts | Short names for the commands: `db:setup` (start Supabase, rebuild the database, load data), `dev` (start the app), `test`, `build` | The `Makefile` and CI call these, so there is one source of truth |
| `Makefile` | `make setup`, `make dev`, `make test`, each forwarding to an npm script | The brief names these commands |
| `supabase/config.toml` | Supabase's settings. We switch off the parts we don't use (analytics, the admin dashboard, email catcher, file storage, live updates, edge functions) | Fewer things to download and fewer ways to fail on the grader's Mac. Analytics in particular often fails on Macs |
| Schema migration (tables) | Creates nine tables: `companies`, `recruiters`, `candidates`, `searches`, `shortlists`, `shortlist_members`, `saved_briefs`, `subscriptions`, `billing_events` | The database shape everything else uses |
| `seed.sql` | Inserts the two companies, acme and globex, with fixed IDs | Fixed IDs make tests predictable |
| `scripts/supabase-env.mjs` | Asks the running Supabase for its address and keys | The brief forbids `.env` files on the grader's machine, so we read the values live instead |
| `scripts/with-env.mjs`, `scripts/dev.mjs` | Run a command (tests, the app) with those values added | Same reason |
| `scripts/setup-data.mjs` | (1) creates the two recruiter logins; (2) loads all 5,000 candidates in batches of 500, stopping if the count isn't exactly 5,000; (3) writes `lib/shared/vocab.ts`, the list of every real role, city, skill, company, degree, field and school | The vocabulary is what stops the AI from inventing values. For search speed, each candidate is also stored with simple lists (all companies, all degrees…) |
| `tests/helpers.ts` | Test tools: sign in as a recruiter, call our API, act as a recruiter directly on Supabase, reset a company to "free, no searches used" | Every later test uses these |
| `tests/gate.test.ts` | Checks 5,000 candidates, both logins, and the app answering on port 3000 | The minimum the grader needs |
| CI workflow | On every push, GitHub runs setup (twice) on a clean Linux machine, checks no `.env` appeared, starts the app and runs the tests. A second job does it with no AI or Stripe keys | Catches "works on my machine" problems early |

**Questions for you:**
- Both recruiters share the password `rotto-assessment`, and it's written in the README. Fine for a local test app, but is that what you'd expect?
- The allowed-values list is built once, at setup. If `candidates.json` changed, you'd re-run `make setup`. We decided this together; just confirming it still feels right.

---

## Phase 2: Database and security (Tasks 4–5)

**What it establishes:** the database itself keeps the companies apart and protects plans, search counts and billing. This holds even if a recruiter skips our app and talks to Supabase directly with their own login token.

| Function / rule | What it does, in plain words |
|---|---|
| `current_company_id()` | "Which company does the signed-in person belong to?" Every privacy rule and every search-count function relies on this one answer. The company comes only from the login, never from anything the browser sends |
| `f_arr`, `f_num`, `f_txt` | Small helpers that read one filter safely. A filter of the wrong type counts as "not set", never as an error and never as "match everyone" |
| `filters_have_conditions(f)` | Answers "is there at least one real condition, and nothing unsupported?" If not, the search returns nobody. This is the database's own copy of the "never return everyone" rule; the server has the first copy |
| `search_candidates(f, lim, off)` | **The one search query.** Exact matching on every filter, all filters must match, sorted open-to-work first, then most years, then ID so the order never changes between pages. Returns one page plus the total. Only our server may call it (Option A) |
| `reserve_search(brief)` | Takes the company's free search **before** the AI is called, in one indivisible step. If 20 searches arrive at the same instant, exactly one gets it. Paid companies always get one |
| `complete_search(id, filters)` | Marks a reserved search done and stores its final filters |
| `refund_search(id)` | Gives the search back if something failed. Only works while the search is still in progress, so nobody can refund a finished search to get a free one |
| `create_correction(parent, filters)` | Used when the recruiter edits a chip. Creates a linked search without using quota, capped at 10 per original search (11th → "start a new search") |
| `apply_billing_event(...)` | Handles one Stripe event in a single all-or-nothing step: ignore it if we've seen it before; ignore it if it's older than what we already have; if two arrive in the same second, a cancellation wins; then recompute both companies' plans |
| Privacy rules (RLS) | Each company can see only its own shortlists, list members, saved searches and searches. Billing tables are invisible to recruiters. Recruiters can't read candidates directly at all (Option A) |
| Permissions (grants) | Supabase lets signed-in users do a lot by default. We remove all of that, then give back only what's needed. Recruiters can never write to companies, searches, subscriptions or billing; those change only through the functions above |

**Tests:** `db.test.ts` checks the search, the race (20 at once → exactly 1), refunds, the correction cap and billing order. `isolation.test.ts` signs in as acme and tries every kind of change on every table aimed at globex. Each attempt must get "permission denied", and a before-and-after snapshot must be identical. It also tries to move acme's recruiter into globex, and to search candidates directly.

**Questions for you:**
- If the server crashes between taking a search and giving it back, that one search is lost. We accepted this as rare. Agree?
- A Stripe status of `active` or `trialing` counts as **paid**; everything else (`past_due`, `canceled`, `incomplete`…) counts as **free**. Is treating `past_due` as free right?
- 10 corrections per search: generous enough, or too generous?

---

## Phase 3: Search (Tasks 6–9)

**What it establishes:** brief in, filters and people out. This is the biggest score (25 points for accuracy).

**The filter check (`lib/shared/filters.ts`)**
- `Filters` describes every filter we support: roles, seniorities, cities, skills (must have **all**), any_skills (needs **at least one**), companies worked at, current company, degrees, fields, schools, minimum and maximum years, open to work, startup or enterprise (past or current), and `unsupported`.
- `cleanFilters(input)` is **the single gate** for every filter, whether it comes from the AI, the browser or the database:
  - Real values are kept.
  - A value not in our data (e.g. "London") becomes an amber "not in our data" chip.
  - An unknown field or a wrong type becomes the same kind of chip.
  - Years are kept between 0 and 15. Duplicates are removed.
  - Filters that do nothing (0+ years, "not required to be open to work") are dropped, so they can't mean "everyone".
  - It also reports whether the search can run: at least one real condition and nothing unsupported.

**The AI call**
- `prompt.ts` holds the instructions given to the model, plus a strict form for its answer. Every field may only contain values that exist in our data, so the model *cannot* return a city we don't have. The instructions cover typos ("Pyhton" → Python), nicknames (NYC, k8s), states → cities, "or" versus "and", and what to mark unsupported or unclear.
- `llm.ts` → `briefToFilters(brief)` makes **one** request. It sends only the instructions and the brief, never candidate data. Temperature 0 means the same brief gives the same answer. It gives up after 6 seconds and never retries.

**Server plumbing (`lib/server/`)**
- `http.ts`: `route()` wraps every API route so known errors become a plain sentence and anything unexpected becomes a generic message (never a stack trace or SQL). `readJson`, `requireUuid` and `must` are small checking helpers.
- `supabase.ts`: two ways to talk to the database. `userClient(token)` acts *as the recruiter*, so all privacy rules apply. `adminClient()` uses the server's own key, which skips them; it's used only for the webhook and for reading candidates after the recruiter is checked.
- `auth.ts` → `requireRecruiter(req)`: no valid login means 401. Otherwise it finds the recruiter's company.

**The search flow (`search.ts`)**

| Function | What it does |
|---|---|
| `getPlan` | Returns `{plan, searches_remaining}`: free gives 1 or 0, paid gives "unlimited" (null) |
| `newSearch` | Check the brief (1–500 characters) → AI key missing? 503 with nothing used → take the search (no search left: 402) → ask the AI → clean the filters → `finish` |
| `finish` | Fetch page 1 and the plan **first**, then mark the search done as the very last step. If anything fails before that, the search is refunded and the user sees "it wasn't counted" |
| `correctSearch` | A chip edit: no AI, no quota, the parent must be your company's, at most 10 |
| `rerunSaved` | Re-run a saved search with the filters **stored on the server** (never the browser's copy). No AI, but it does use a search |
| `getPage` | Page N of a finished search. Re-runs the same query, never counts as a search; page 0, -1 or "abc" gives 400; past the end gives an empty list |

**Tests:** `search-api` covers every route and status code. `accuracy` replays every sample query exactly like the grader (search, then page to the end) and prints precision, recall and the average. It also runs our 17 extra briefs (typos, states, unsupported asks, injection attempts), which must give 0 results and change no data. `quota` sends 20 searches at once and expects exactly one success. `speed` checks paging under 150 ms and search under 2 s.

**Questions for you (the most important ones for accuracy):**
- Matching is **exact**. "Senior" means seniority = senior, not "senior or above". "5+ years" means at least 5; "under 3 years" means at most 2. Does that match how a recruiter would read their own brief?
- Vague words ("experienced", "good with data") give **zero results** plus an amber chip asking them to pick a filter, rather than a guess. It's safe, but strict. OK?
- Results are ordered open-to-work first, then most experience. Since the sample answers are exact sets, order doesn't affect the score; it only affects what the recruiter sees first. Is that the order a recruiter would want?
- "Worst" or "best" candidates: we ignore those words (no data supports them). Agreed earlier; just confirming.

---

## Phase 4: Billing (Task 10)

**What it establishes:** Stripe tells us about subscriptions, and plans change correctly even when messages repeat, arrive out of order, or are forged.

| Function | What it does |
|---|---|
| `verifyStripeSignature(raw, header, secret)` | Stripe signs each message with a shared secret. We recompute the signature over the **exact bytes received** and compare safely. If the body is reformatted in any way, it fails. Several signatures in one header are allowed; old timestamps are allowed |
| `processStripeWebhook(raw, header)` | No secret configured → 500. Bad signature → 400. Otherwise always 200: not a subscription event, a malformed body or an unknown company are ignored and logged. A subscription event goes to `apply_billing_event` |
| Route `POST /api/billing/events` | Reads the raw body and passes it on untouched |

**Tests:**
- The unit test checks the real sample signatures, tampered and reformatted bodies, odd bodies, and a missing secret.
- The integration test replays the sample file with **whatever secret the server runs with** (the graders use their own) and checks both companies' plans after every event: acme ends free, globex ends paid.
- It also sends the same event three times at once and expects it to be applied once.

**Questions for you:**
- We accept old timestamps on purpose (the graders replay old events). The trade-off: someone who captured a real signed message could replay it, but a repeat is ignored anyway. Fine?
- The Upgrade button **explains** how upgrading works (your admin subscribes through Stripe and the plan switches automatically). There is no real checkout page, because the brief gives us webhooks, not a checkout. Does that match your reading?

---

## Phase 5: Shortlists, saved searches, people (Tasks 11–12)

**What it establishes:** the rest of the API, each route also attacked from the other company's side.

| Function (`lists.ts`) | What it does |
|---|---|
| `listShortlists` | Your company's lists, each with its count and member IDs (the UI uses the IDs to show ✓ Shortlisted) |
| `createShortlist` / `renameShortlist` | Name of 1–80 characters; a name your company already uses gives 409 |
| `getShortlist` | The list (privacy rules apply), then the people's cards, newest first |
| `deleteShortlist` | Removes the list and its members |
| `addMember` / `removeMember` | Adding twice is fine (no duplicate, no error); unknown candidate → 404 |
| `listSaved` / `createSaved` / `deleteSaved` | Saved searches store the brief plus the **cleaned** filters |
| `getPerson` | The full original candidate record for the profile view |
| `requireOwnList`, `requireCandidateId` | "Another company's list" and "no such list" both give 404, so nobody can probe what exists. Odd IDs give 400 |

**Questions for you:**
- Lists and saved searches belong to the **company**, so everyone at acme sees acme's lists. The brief has one recruiter per company, so it's invisible today. Agree that company-wide is right?
- Deleting a list is permanent (the UI asks first). OK?

---

## Phase 6: UI (Tasks 13–18)

**What it establishes:** every screen and state from DESIGN.md, light and dark, desktop and phone. Pages only talk to our `/api`; the browser holds only the public Supabase address and key.

| Piece | What it is |
|---|---|
| `globals.css`, `layout.tsx` | Colour tokens (Graphite & Signal), dark mode, Instrument Sans |
| `lib/client/api.ts` | Every page's way of calling our API with the login token. An expired login signs you out to the sign-in page |
| `components/ui.tsx` | `Button` (44 px tall on phones), `Skeleton` (grey loading shapes) |
| `app-shell.tsx` | Shared state (plan, your lists), top bar, phone bottom bar, the "you've used your free search" banner, the Upgrade dialog |
| Sign-in page, `(app)/layout` | The sign-in form; every other page redirects there if you're not signed in |
| `chip-model.ts` + `ChipBar.tsx` | Turns filters into chips. Tap a chip to pick another real value from a searchable list; × removes it; + Filter adds one; Clear filters removes all. The recruiter can never type a value that isn't in the data |
| `states.tsx` | First visit (examples that fill the box but don't run it), loading skeletons, errors with Try again, "no one matches" with what to do next |
| `ResultRow.tsx` | One result: photo, name, open-to-work badge, title, city, years, top skills (searched skills highlighted), Shortlist button |
| Search page | Ties it together. The current search is kept in the page address, so leaving and coming back (or reloading) restores it, and a free user can still refine it |
| `ShortlistButton`, `ProfilePanel` | Shortlist to any list or a new one; the profile is docked beside results on desktop and full screen on a phone |
| Shortlists, list detail, Saved searches pages, `ConfirmDialog`, `EmptyState` | Manage lists; re-run saved searches (the page notes that a re-run uses a search on the free plan) |

**Questions for you:**
- "Show more" loads 20 at a time instead of numbered pages. Fine for recruiters?
- "Save search" is disabled for a search that can't return anyone (unsupported or empty filters), because re-running it would waste a search. OK?

---

## Phase 7: Hardening and submission (Tasks 19–20)

**What it establishes:** proof for every scoring row, then a clean hand-in.

| Piece | What it does |
|---|---|
| `scripts/check-secrets.mjs` | Downloads what a browser would get, from both the production build and the running dev server, and fails if any secret value, or anything shaped like one, appears. One leak would zero the 10 security points |
| Scoring walk | Every row in SCORING.md goes ✅ only with evidence (a test name, an output or a screenshot) |
| Measurements | Accuracy, speed and cost per search measured with the **final** prompt and written into the README |
| Fresh clone | Clone into a new folder, `make setup`, `make dev`, check that no `.env` appeared |
| Mac run | Your friend runs a zip **without `docs/`** (the brief stays private); if that can't happen, it's logged as an accepted risk |
| README + Loom script | One page covering what the brief asks for; a talk track of about 4½ minutes |
| Submission | Invite gibbsdylan, check CI is green on the final commit, submit before **Sat 11:09 AM EDT** (target 9:00) |

---

## Where your eyes help most

1. **Phase 3 questions:** how a recruiter really means "senior", "5+ years", vague words. This is where accuracy points are won or lost.
2. **Phase 2 billing statuses:** whether `past_due` should count as paid.
3. **Phase 4 Upgrade:** explanation only, with no checkout page.
4. **Anything in the brief that you read differently from this page.** You've read it closely, and a different reading is exactly the blind spot I can't see.
