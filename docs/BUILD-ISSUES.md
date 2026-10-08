# Problems found while building, and how each was fixed

Phases 1–6, built 2026-10-07/08 on the `build` branch. Each entry says what went wrong, how it was found, and the fix. The method was the same every time: reproduce or measure the problem, find the real cause, write a check that fails because of it, fix it, then confirm the check passes and nothing else broke.

| # | Problem | Fix | Proof |
|---|---|---|---|
| 1 | Paging took 426 ms (grader allows 300) | `MATERIALIZED` on the filter step of `search_candidates` | Query 240 ms → 7 ms; paging p95 ≈ 50 ms |
| 2 | `make setup` sometimes failed after the database restart | Loader waits until Supabase answers | 3 setup runs in a row pass |
| 3 | "React engineers" showed 7 role chips | All 7 engineering roles shown as one "Any engineer" chip | Unit test (failed first, now passes) + browser check |
| 4 | AI added a wrong Frontend role; treated "great" as unclear | Two prompt rules | 10/10 samples exact, 17/17 extra briefs |
| 5 | Speed test failed at random | Fails only above the grader's 3 s; prints the number | Repeated runs |
| 6 | GitHub check failed: "vitest: not found" | `npx vitest` | Both GitHub checks green |
| 7 | Upgrade and "Shortlisted" buttons not orange | A proper "accent" button style | Screenshots, light and dark |
| 8 | Next.js "N" badge covered the phone menu | Turned off in `next.config.ts` | Screenshot |
| 9 | Next.js wrote `AGENTS.md` into the project | Turned off in `next.config.ts` | Clean `git status` after start |
| 10 | "Clear filters" too small to tap on a phone | 44 px tall on phones | Every tap target measured ≥ 44 px |
| 11 | Reloaded search came back with an empty box | Box refills with the original brief | Reload check |
| 12 | Photos looked empty in screenshots | Initials fallback if a photo fails | All photos load (HTTP 200); fallback only on failure |
| 13 | TypeScript "might be missing" errors | Marked as present, or treated as empty lists | Build and type-check pass |

---

## 1. Paging was too slow (426 ms; the grader allows 300 ms)

**What was wrong.** A search filter is a small bundle such as `{ roles: [Data Scientist], degrees: [PhD] }`. The search query (`search_candidates`) was written to read that bundle once, in a step named `p`, then check all 5,000 candidates against it. Postgres's optimiser rewrote the query and folded that step into the main loop. It then unpacked the filter bundle again **for every candidate**, about 15 small lookups each, roughly 75,000 extra steps per page.

**How it was found.** Each layer was timed separately instead of guessing:
- Next.js itself took 1–14 ms per request.
- Our code took 270–400 ms.
- The three database calls, timed one by one, came to about 22 ms in total, while the query was the slow one.
- Asking the database to time the query on its own (`EXPLAIN ANALYZE`) showed 240 ms.

**The fix.** One word: `with p as materialized (…)`. It tells Postgres to work this step out once and keep the result. Before the code was changed, both versions were run side by side in the database: **240 ms vs 7 ms**.

**Proof.** Paging p95 is now 48–52 ms. The migration and the plan (`docs/plan/phase-2-database.md`) were both updated.

## 2. Setup sometimes failed with "Database client error"

**What was wrong.** `make setup` rebuilds the database, and Supabase then restarts its services. Our loader (`scripts/setup-data.mjs`) started straight away, sometimes before the database was ready to answer. It worked three times and failed on the fourth, so a grader could have hit it on a clean Mac.

**The fix.** Before loading anything, the loader asks Supabase "are you ready?" once a second, for up to 60 seconds.

**Proof.** Setup run three times in a row, all passing; the full test suite passes after each.

## 3. Seven role chips for "senior React engineers"

**What was wrong.** The AI read "engineers" as "all engineering roles" and added all seven (Backend, Data, DevOps, Frontend, Full Stack, Machine Learning, Mobile). The people found were still correct: 21, exactly the expected answer. But seven chips is cluttered and hard to correct, and correcting filters easily is a graded UI check. The plain brief "engineers in Texas" legitimately produces the same seven roles.

**What did not work.** Two prompt changes (a sharper rule, then a worked example). Calling the AI directly three times still returned all seven roles each time. Both prompt changes were removed rather than kept as edits that don't help.

**The fix.** The chips, not the AI's answer, were changed (`components/search/chip-model.ts`). When all seven engineering roles are present, they show as **one chip, "Role: Any engineer"**:
- × removes all seven at once;
- tapping the chip lets you pick one specific role, which replaces the group.

A partial set (for example Frontend and Backend) still shows as separate chips.

**Proof.** The unit test was written first and seen to fail, then passed. In the browser the chips now read: Any engineer · Senior · New York · React · Worked at a startup.

## 4. A wrong "Frontend Engineer" role, and "great" treated as unclear

**What was wrong.** On the first live run:
- "senior React engineers…" got a Frontend role it shouldn't have, so one sample missed people.
- In "great designers who studied HCI", the AI marked "great" as unclear ("please pick a filter"), which gives zero results.

**The fix.** Two rules in the prompt (`lib/server/prompt.ts`). The plan allows only prompt changes here, never special cases in code.
- A technology before "engineers" is a skill only; never guess a role from it.
- Praise words ("great", "top", "talented", "strong"…) are left out entirely; they are not "unclear".

**Proof.** All 10 sample queries are exact (precision, recall and F1 all 1.000), and all 17 of our own tricky briefs pass, over repeated runs.

## 5. The search-speed test failed at random

**What was wrong.** Our own target for a new search is 2 s; the grader allows 3 s. OpenAI's response time varies with nothing changing on our side: one run measured 1.4 s (p95), another 2.5 s. A test that fails at random because of someone else's server trains everyone to ignore failures.

**The fix.** `tests/speed.test.ts` fails only above the **grader's real limit of 3 s**, and prints the measured number so it can be watched against the 2 s target.

## 6. GitHub check failed: "vitest: not found"

**What was wrong.** The new GitHub job (the app running with no keys) called the test tool by its bare name, which only works inside npm scripts.

**The fix.** `npx vitest` in `.github/workflows/ci.yml`, and in the plan.

**Proof.** Both GitHub jobs (`setup-and-test` and `no-keys`) are green.

## 7. The Upgrade and "Shortlisted" buttons were not orange

**What was wrong.** These buttons had the default grey style with orange layered on top as extra classes. When two styles set the same colour, which wins depends on the order the styling tool (Tailwind) writes them out, and grey won.

**The fix.** A proper `accent` button style in `components/ui.tsx`, used by Upgrade and by the "✓ Shortlisted" state. Each button now gets one clear colour instead of two competing ones.

**Proof.** Screenshots in light and dark mode.

## 8. A round "N" badge covered the phone menu

**What was wrong.** In development mode, Next.js shows a small badge in the corner. Graders run the app in that mode (`make dev`), and on a phone the badge sat on top of the Search tab.

**The fix.** `devIndicators: false` in `next.config.ts`.

## 9. Next.js wrote an extra file into the project

**What was wrong.** Each time the app started, Next.js 16 created an `AGENTS.md` file in the project root. On the grader's machine that's an unexpected new file in a clean clone.

**The fix.** `agentRules: false` in `next.config.ts`.

## 10. "Clear filters" was too small to tap on a phone

**What was wrong.** The browser check measured every button at phone width (375 px). "Clear filters" was only 20 px tall; the scoring asks for at least 44 px.

**The fix.** 44 px tall on phones, unchanged on desktop.

**Proof.** The re-check found no tap target under 44 px on the search, shortlist or saved-search pages.

## 11. A reloaded search came back with an empty box

**What was wrong.** The current search is kept in the page address, so leaving and coming back, or reloading, brings it back. But only the chips and results returned; the search box was empty, so you couldn't see what the results were for.

**The fix.** Restoring a search also refills the box with the original brief.

**Proof.** A reload check now shows "data scientists with a PhD" in the box.

## 12. Photos looked like empty grey circles

**What was wrong.** In the first screenshots, the photos simply hadn't finished loading yet. A proper check showed every photo loading (HTTP 200, real 128 px images). But the photo host (rotto.com) does refuse some automated requests ("429 Too Many Requests"), so a grader could see missing photos.

**The fix.** An `Avatar` component shows the person's initials in a small circle if their photo fails to load. It only appears when a photo actually fails.

## 13. Small type fixes

The Supabase library labels query results as "might be missing", even when the query guarantees a row (`.single()`) or a list. In those places the code now says "this is present" or "treat missing as an empty list". Behaviour is unchanged; the build and type-check pass.

---

## 14. Typing in the search box stuttered once results were loaded

**What you saw:** the search box lagged while typing after a search, worst after "Show more" had loaded many people.

**Cause:** the result rows were drawn inside the same component that holds the typed text. Every keystroke re-drew all of them, each with its Shortlist button.

**How it was checked (measured, not guessed):**
- First the landing animations were ruled out. Frame timing on the real graphics chip held about 90 fps, with or without each effect.
- Then the time from each keystroke to the screen updating:
  - landing page: about 24 to 32 ms;
  - **with 300 rows: about 150 ms, worst 360 ms.**

**Fix:** the list of rows is remembered (`useMemo` in `app/(app)/page.tsx`) and only re-drawn when the rows, the filters or the open profile change. With 300 rows typing is now about 40 ms (worst 72 ms), close to the empty page's 32 ms. Re-checked: refine, Show more, Save search, opening and switching profiles, shortlisting from a row, the phone layout. No errors.

---

## 15. Landing page stuttered and the fans ran on the laptop screen (not on the second screen or phone)

**What you saw:** the landing page stuttered even without typing, and the fans got loud, but only on the laptop's own screen.

**Cause:**
- The laptop screen is 2880×1800 at 200% scaling, refreshing 90 times a second. That is about 4× the pixels per second of a 1080p 60 Hz monitor.
- Each of the five landing rings had a faint `blur(.5px)`. On a 3D-tilted layer the browser re-applies that blur to every ring on every frame, even when the rings are paused.
- At that screen size this kept the GPU at 96% (Brave's graphics process). Every CPU process was nearly idle; the test suite was not running.

**How it was checked:** GPU load was read from Windows' performance counters with the page at the real screen size, switching one effect off at a time:
- rings off → 8%;
- halo, glow, dots, mask or typing placeholder off → no real change;
- **blur off → 9%**, the same as no rings;
- pausing the rings without removing the blur → no change.

**Fix:** removed that one line from `.hero-ring` in `app/globals.css`. GPU load is now:
- 5–8% at the laptop's size (was 37–51% in the test window);
- 3–4% at MacBook Pro 16" size (was 29%).

Light and dark screenshots look the same as before. MacBooks (2× screens, up to 120 Hz) would have hit the same problem.

---

## 16. The first search and first page were too slow on a freshly started server

**Found in the brief-by-brief audit.** The brief measures speed "on our machine": a new search under 3 s, a page under 300 ms.

**Cause:** `next dev` builds each route the first time it is requested, which takes 1–3 s. Our speed tests never saw this, because they always ran against a server that had already been used.

**Measured on a fresh `make dev` with an empty build cache (before → after):**
- first search: 4,354 → **1,694 ms**;
- first page: 1,174 → **94 ms**;
- first profile: 1,270 → **50 ms**.

**Fix:** `scripts/dev.mjs` requests every page and API route once as soon as the server is up. The requests carry no token, so they get 401 (or 400 for the webhook) and read or change nothing, but every route is built before anyone uses it. It finishes about 20 s after start and prints "✓ All routes built".

---

## Smaller changes from the plan, all recorded in the progress log

- TypeScript 5 rather than the brand-new version 7, because Next.js 16's build uses TypeScript 5.
- This Supabase version calls its email catcher `local_smtp` (not `inbucket`); that's the section switched off.
- Test output is always shown (`silent: false`). Otherwise the accuracy and speed numbers were hidden whenever the tests passed.
