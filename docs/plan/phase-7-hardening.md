# Phase 7: Hardening, README, Loom, submission

> **In short:** Proves every row of SCORING.md with evidence, checks that no secret reaches the browser (production build and the running dev server), and runs a fresh clone like the grader.
> Then writes the one-page README with measured numbers and the Loom script, and submits before Saturday 11:09 AM EDT.

Goal: prove every row of [SCORING.md](../SCORING.md), ship a one-page README, prepare the Loom, and submit before **Sat 2026-10-10 11:09 AM EDT**, aiming for **9:00 AM**.

---

### Task 19: Secret scan, full scoring walk, Mac run

**Files:**
- Create: `scripts/check-secrets.mjs`
- Modify: `.github/workflows/ci.yml`, `docs/SCORING.md` (status column)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write `scripts/check-secrets.mjs`**

```js
// Scans what browsers can download for secret values or secret-shaped strings. A single hit fails:
// the brief scores the whole 10-point block as zero for one exposed key.
//   node scripts/check-secrets.mjs                         → the production build (.next/static + pre-rendered pages)
//   node scripts/check-secrets.mjs http://localhost:3000   → what the running `make dev` server actually sends (what graders see)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

async function fromServer(base) {
  const out = [];
  for (const path of ['/', '/sign-in', '/shortlists', '/saved']) {
    const html = await (await fetch(base + path)).text();
    out.push([path, html]);
    for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      out.push([src, await (await fetch(new URL(src, base))).text()]);
    }
  }
  return out;
}
const fromBuild = () => [
  ...walk('.next/static'),
  ...walk('.next/server/app').filter((p) => /\.(html|rsc|body)$/.test(p)),
].map((p) => [p, readFileSync(p, 'utf8')]);

const files = process.argv[2] ? await fromServer(process.argv[2]) : fromBuild();
const values = ['OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
  .map((k) => [k, process.env[k]])
  .filter(([, v]) => v && v.length >= 8);
// The service-role key is a JWT, so it is caught by value above (with-env.mjs sets SUPABASE_SECRET_KEY).
const shapes = [/sb_secret_[A-Za-z0-9_-]{8,}/, /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/, /whsec_[A-Za-z0-9_]{8,}/];

let hits = 0;
for (const [name, text] of files) {
  for (const [key, value] of values) if (text.includes(value)) { console.error(`LEAK: value of ${key} in ${name}`); hits++; }
  for (const re of shapes) if (re.test(text)) { console.error(`LEAK: ${re} in ${name}`); hits++; }
}
console.log(`Scanned ${files.length} files: ${hits} leaks.`);
process.exit(hits ? 1 : 0);
```

- [ ] **Step 2: Run it against a production build**

```bash
npm run build
node scripts/with-env.mjs node scripts/check-secrets.mjs
```
Then, with `npm run dev` running and signed-in pages visited once (so dev has compiled them):
```bash
node scripts/with-env.mjs node scripts/check-secrets.mjs http://localhost:3000
```
Expected both times: `Scanned N files: 0 leaks.`, with `OPENAI_API_KEY` and `STRIPE_WEBHOOK_SECRET` set in the shell so their values are checked too.

- [ ] **Step 3: Add the scan to CI** (after `make test` in the `setup-and-test` job of `.github/workflows/ci.yml`, while `make dev` is still running)

```yaml
      - name: scan what the running dev server sends, then the production build, for leaked secrets
        run: |
          node scripts/with-env.mjs node scripts/check-secrets.mjs http://localhost:3000
          npm run build
          node scripts/with-env.mjs node scripts/check-secrets.mjs
```

- [ ] **Step 4: Walk SCORING.md row by row**

With the stack running and the key set: `npm test` (every suite green), then go through every row of `docs/SCORING.md`, change ⬜ to ✅ only with evidence (a test name, a command output, or a screenshot), and fill in "Baseline / best eval score" from the `MEAN over N samples` line of the accuracy test. Anything not ✅ is fixed before moving on.

Then measure the README's model numbers with the **final** prompt (it is bigger than the one tested in NOTES.md):
- Restart dev with `LOG_LLM_USAGE=1`, run three different searches, and read the `llm usage` lines: `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`.
- Cost per search = (uncached input × $0.40 + cached input × $0.10 + output × $1.60) / 1,000,000 (gpt-4.1-mini list prices; re-check them on the OpenAI pricing page that day).
- Exact-match score and p50/p95: from the accuracy and speed test output.
Write these numbers into the README in Task 20; never reuse the NOTES.md numbers unmeasured.

- [ ] **Step 5: Fresh-clone run on this machine**

```bash
npx supabase stop --no-backup   # in THIS repo first: frees the ports and deletes the dev volumes, so the clone really starts empty
cd "$TEMP" && rm -rf rotto-clean && git clone https://github.com/akv-iu/rotto-fullstack-task-akshay rotto-clean && cd rotto-clean
make setup && make dev    # or: npm ci && npm run db:setup && npm run dev
git status --short --ignored | grep -E '(^|/)\.env' && echo "FAIL: a .env file appeared" || echo "OK: no .env"   # second terminal
```
Expected: the app on :3000; sign in as acme; one search works; `OK: no .env`. Afterwards `npx supabase stop --no-backup` in the clone and `make setup` back in this repo.

- [ ] **Step 6: Mac run (the user's friend), Friday**

The brief is confidential and `docs/` quotes it, so the friend gets **the code without `docs/`** and is **not** added as a collaborator:
`git archive --format=zip -o rotto.zip HEAD ':(exclude)docs'` (check the zip has no `docs/` folder before sending). Steps to send:
```bash
# Needs: Docker Desktop running, Node 24. Apple Silicon or Intel: note which in the result.
brew install node@24 && brew link --overwrite --force node@24 && node -v   # must print v24.x
export OPENAI_API_KEY=...            # yours, sent privately; revoke or rotate it afterwards
export STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample
make setup
make dev                             # open http://localhost:3000, sign in recruiter@acme.test / rotto-assessment, run one search
```
Record the result (OK / the exact error, plus chip type) in NOTES.md. If no Mac run happens by Friday night, write that in NOTES.md as an accepted risk: Linux CI plus the Windows run are the evidence, and the CLI and Node versions are pinned.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-secrets.mjs .github/workflows/ci.yml docs/SCORING.md docs/NOTES.md
git commit -m "chore: secret scan in CI; scoring walk evidence"
```

---

### Task 20: README (one page), Loom script, submission

**Files:**
- Replace: `README.md`
- Create: `docs/LOOM.md`

- [ ] **Step 1: Replace `README.md` (must fit on one page; update the numbers from the final test run)**

```markdown
# Rotto: plain-English candidate search

Describe who you want; an LLM turns it into filters; Postgres finds the people. Next.js 16 + local Supabase.

**Run** (needs Docker Desktop running and Node 24): `export OPENAI_API_KEY=… STRIPE_WEBHOOK_SECRET=…` then `make setup` and
`make dev` → http://localhost:3000 (recruiter@acme.test / recruiter@globex.test, password `rotto-assessment`).
With `make dev` running, `make test` runs the grader-style suites.

## How search works
1. **One LLM call per new search** turns the brief into filter JSON. Nothing else goes to the model: never candidates.
2. **Code checks every value** against lists built from `candidates.json` at setup (13 roles, 10 cities, 79 skills, …).
3. **One fixed, parameterized SQL function** matches exactly (AND across fields) and pages 20 at a time in a stable order
   (open to work, then experience, then id). Paging re-runs it (a few ms at 5k rows) and never counts as a search.
4. Editing a chip re-runs **without the LLM and without using a search** (capped at 10 per search).

The sample answers are exact filters (all 9 non-empty samples reproduce exactly), so precision comes from getting the filters right, not from ranking.

## How it avoids inventing filters
- Structured output with **enums of the real values**: the model cannot return a city or skill we don't have.
- Anything it can't map goes to `unsupported` (e.g. "speaks Japanese") or `unclear` (e.g. "experienced"),
  shown as an amber chip, and the result is **empty** rather than wrong. Remove the chip to search without it.
- No real conditions left (vague or hostile briefs) → nobody, never everyone (checked in code **and** in SQL).

## Model: `gpt-4.1-mini-2025-04-14`
Final prompt, measured in Task 19: N/N samples exact, p50 X s, p95 Y s (fill in from the test output). Newer minis added a wrong "Frontend" role to
"React engineers" (45/50); Gemini Flash was accurate but 6 to 21 s on the free tier; Flash-Lite dropped cities.
**Cost per search ≈ $Z** (A input tokens, B of them cached, C output; fill in from Task 19's `llm usage` lines).

## Tradeoffs
- **Security in the database:** RLS on every table, company-scoped constraints, privileged tables writable only through
  `security definer` functions. A recruiter calling Supabase directly can't read the other company or touch plan or quota.
- **Free plan:** one conditional `UPDATE` reserves the search before the LLM call (20 concurrent → exactly 1); a failure refunds
  it, and only a still-pending search can be refunded.
- **Billing:** HMAC on the raw body (`node:crypto`), dedup by event id and ordering by `event.created` in one transaction;
  no timestamp tolerance (events are replayed); a same-second cancellation wins.
- **6 s LLM timeout:** a rare slow but correct search beats a fast failed one.
- Allowed values are built at setup because the data is fixed; a growing product would read them from the database.

## With another week
Ranking signals beyond exact match for broad briefs · a "did you mean" chip when a value is close to a real one · Playwright
UI tests · alert on saved searches · per-recruiter usage reporting.
```

- [ ] **Step 2: Check it fits on one page**

Print preview at a normal font size, or keep it at about 60 lines or fewer. Cut "With another week" items before cutting any required section (search, invented filters, model and why, cost per search, tradeoffs, another week).

- [ ] **Step 3: Write `docs/LOOM.md` (the user records it; 5 minutes or less)**

```markdown
# Loom script (aim for 4:30; hard limit 5:00)

Before recording: `make setup` (fresh), then set **acme to paid** (replay the sample events, or SQL) so every demo search works.
Globex stays on the free plan for the Upgrade demo.

0:00 **What it is** (20 s): one sentence plus the screen: brief → chips → results.
0:20 **Search demo** (60 s): "senior React engineers in New York who have worked at a startup" → 21 people, React highlighted.
     Edit the City chip to Boston: instant, no search used. Show "speaks Japanese" → amber chip, nothing returned, and why.
1:20 **Decision 1: the LLM only translates** (45 s): enums from the data, cleanFilters, unsupported/unclear → empty,
     one fixed SQL function. The data finding: the samples are exact filters, so filters matter more than ranking.
2:05 **Decision 2: security lives in the database** (45 s): RLS, the composite key on list members, functions as the only
     write path; the refund hole we found and closed (pending-only refunds). Show the isolation test passing.
2:50 **Decision 3: free plan and billing** (45 s): reserve-before-LLM with one conditional UPDATE (20 concurrent → 1);
     webhook: raw-body HMAC, dedup + ordering in one transaction; replay the sample → acme free, globex paid.
3:35 **Model choice and cost** (30 s): the comparison table; gpt-4.1-mini, ~$0.0005 per search; the 6 s timeout reasoning.
4:05 **Phone + shortlist + save** (40 s): 375 px view, shortlist from a row, save the search; sign in as globex for the free plan banner and the Upgrade dialog.
4:45 **Another week** (15 s).
```

- [ ] **Step 4: Commit and push (so CI checks the final commit)**

```bash
git add README.md docs/LOOM.md
git commit -m "docs: one-page README and Loom script"
git push
```

- [ ] **Step 5: Final checks and submission (user)**

```bash
npm test                                      # all green, key set
git status                                    # clean
gh run watch                                  # CI green on THIS commit (both jobs)
gh api -X PUT repos/akv-iu/rotto-fullstack-task-akshay/collaborators/gibbsdylan
gh api repos/akv-iu/rotto-fullstack-task-akshay/invitations --jq '.[].invitee.login'   # must list gibbsdylan
```
Personal repos ignore a `permission` setting: an invite always gives write access. Then record the Loom from `docs/LOOM.md` and submit the repo URL plus the Loom URL at https://rotto.com/careers/assessment/submit **before 11:09 AM EDT Saturday** (target 9:00 AM).

---

## Requirements check (plan review, 2026-10-07)

An independent reviewer checked this phase against TECH_REQUIREMENTS, SCORING, SPEC, ARCHITECTURE and DESIGN. I verified each finding against those docs before accepting or rejecting it.

| Requirement | Where in this phase | Proof |
|---|---|---|
| X3 / SCORING security: no secret in pages or JavaScript | `check-secrets.mjs` on the build **and** the running dev server | CI step, Task 19 Step 2 |
| D2: README sections (search, invented filters, model and why, cost per search, tradeoffs, another week) | Task 20 Step 1 | numbers measured in Task 19 Step 4, not copied |
| D3: Loom ≤ 5 minutes | `docs/LOOM.md` | aims for 4:30 |
| D5: brief stays confidential | Mac zip excludes `docs/`; friend is not a collaborator | Task 19 Step 6 |
| Gate: fresh clone works, no `.env` | Task 19 Step 5 | `OK: no .env` check |
| Submission before Sat 11:09 AM EDT, Dylan invited | Task 20 Step 5 | invitation listed by `gh api` |
| Whole-plan coverage | every SCORING row has an owning task and a proof | review found S7, X4 and baseline-score gaps; all three are now owned (Tasks 10, 9, 9) |

**Changed after review:** the Mac zip no longer includes `docs/` (it quotes the brief); the secret scan also checks what `make dev` serves, which is what graders load; README and Loom are committed before the final CI check; the cost and accuracy numbers are measured with the final prompt; the clean-clone run stops the dev stack and deletes its data first; `brew link` for Node 24; a fallback if no Mac run happens; README mentions Docker and Node 24; the Loom has 30 s of slack and a note on which company to use for each demo; a check that Dylan's invite exists.

**Rejected:** scanning for the plain text `service_role`. The key's actual value is already checked, and that word may appear in the Supabase library itself, which would fail the scan falsely.

**Verdict:** ready to implement.
