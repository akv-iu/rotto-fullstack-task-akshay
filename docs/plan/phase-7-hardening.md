# Phase 7: Hardening, README, Loom, submission

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
// Scans what browsers can download (static assets + pre-rendered pages) for secret values or secret-shaped strings.
// A single hit fails: the brief scores the whole 10-point block as zero for one exposed key.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = [
  ...walk('.next/static'),
  ...walk('.next/server/app').filter((p) => /\.(html|rsc|body)$/.test(p)),
];
const values = ['OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
  .map((k) => [k, process.env[k]])
  .filter(([, v]) => v && v.length >= 8);
const shapes = [/sb_secret_[A-Za-z0-9_-]{8,}/, /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/, /whsec_[A-Za-z0-9_]{8,}/];

let hits = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [name, value] of values) if (text.includes(value)) { console.error(`LEAK: value of ${name} in ${file}`); hits++; }
  for (const re of shapes) if (re.test(text)) { console.error(`LEAK: ${re} in ${file}`); hits++; }
}
console.log(`Scanned ${files.length} files: ${hits} leaks.`);
process.exit(hits ? 1 : 0);
```

- [ ] **Step 2: Run it against a production build**

```bash
npm run build
node scripts/with-env.mjs node scripts/check-secrets.mjs
```
Expected: `Scanned N files: 0 leaks.`, with `OPENAI_API_KEY` and `STRIPE_WEBHOOK_SECRET` set in the shell so their values are checked too.

- [ ] **Step 3: Add the scan to CI** (after `make setup` in `.github/workflows/ci.yml`)

```yaml
      - name: build and scan for leaked secrets
        run: |
          npm run build
          node scripts/with-env.mjs node scripts/check-secrets.mjs
```

- [ ] **Step 4: Walk SCORING.md row by row**

With the stack running and the key set: `npm test` (every suite green), then go through every row of `docs/SCORING.md`, change ⬜ to ✅ only with evidence (a test name, a command output, or a screenshot), and fill in "Baseline / best eval score" from the accuracy test output. Anything not ✅ is fixed before moving on.

- [ ] **Step 5: Fresh-clone run on this machine**

```bash
cd "$TEMP" && rm -rf rotto-clean && git clone https://github.com/akv-iu/rotto-fullstack-task-akshay rotto-clean && cd rotto-clean
npx supabase stop --all   # stop the dev stack first; both use the same ports
make setup && make dev    # or: npm ci && npm run db:setup && npm run dev
```
Expected: the app on :3000; sign in as acme; one search works. No `.env` was created at any point.

- [ ] **Step 6: Mac run (the user's friend), Friday**

Send these steps (the repo is private, so either add the friend as a temporary collaborator or send `git archive --format=zip HEAD -o rotto.zip`):
```bash
# Needs: Docker Desktop running, Node 24 (e.g. `brew install node@24`)
export OPENAI_API_KEY=...            # yours, sent privately; revoke or rotate it afterwards
export STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample
make setup
make dev                             # open http://localhost:3000, sign in recruiter@acme.test / rotto-assessment, run one search
```
Record the result (OK / the exact error) in NOTES.md.

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

**Run:** `export OPENAI_API_KEY=… STRIPE_WEBHOOK_SECRET=…` then `make setup` and `make dev` → http://localhost:3000
(recruiter@acme.test / recruiter@globex.test, password `rotto-assessment`). `make test` runs the grader-style suites.

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
Tested against the samples plus hostile briefs: 50/50 exact, p50 1.3 s, p95 1.9 s. Newer minis added a wrong "Frontend" role to
"React engineers" (45/50); Gemini Flash was accurate but 6 to 21 s on the free tier; Flash-Lite dropped cities.
**Cost per search ≈ $0.0005** (~1,400 input tokens, mostly prompt-cached, ~90 output).

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
# Loom script (≤ 5:00)

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
4:05 **Phone + shortlist + save** (40 s): 375 px view, shortlist from a row, save the search, the Upgrade dialog.
4:45 **Another week** (15 s).
```

- [ ] **Step 4: Final checks and submission (user)**

```bash
npm test                                      # all green, key set
git status                                    # clean
git push && gh run watch                      # CI green
gh api -X PUT repos/akv-iu/rotto-fullstack-task-akshay/collaborators/gibbsdylan -f permission=read
```
Then record the Loom from `docs/LOOM.md` and submit the repo URL plus the Loom URL at https://rotto.com/careers/assessment/submit **before 11:09 AM EDT Saturday** (target 9:00 AM).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/LOOM.md
git commit -m "docs: one-page README and Loom script"
git push
```
