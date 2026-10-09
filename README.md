# Rotto: plain-English candidate search

**Run** (Docker Desktop running, Node 24): `export OPENAI_API_KEY=… STRIPE_WEBHOOK_SECRET=…`, then `make setup && make dev` → http://localhost:3000. Sign in as `recruiter@acme.test` or `recruiter@globex.test` / `rotto-assessment`. `make test` runs 177 tests (8 more cover running without keys).

**How search works.** One LLM call turns the brief into filter JSON; no candidate data is sent. One fixed, parameterized SQL function returns exact matches, 20 per page: open to work first, then most experienced, then ID; paging never uses a search (p95 44–150 ms). Editing a chip re-runs without the LLM or a search. The samples are exact filter matches, so precision comes from correct filters: all 10 return exactly the right people.

**How invented filters are prevented.** Strict structured output with the real values as enums: the model can't name a city or skill we don't have, and code re-checks every value. Exclusions have their own filters ("without a PhD", "doesn't know Java", "never at a startup"). Anything it can't map ("speaks Japanese", "experienced", linked conditions like "A in X or B in Y") becomes an amber chip and the search returns **nobody**, not the wrong people. No real conditions (vague, hostile or injection briefs) → nobody, never everyone, enforced in code and again in SQL (a filter set matching all 5,000 returns nobody).

**The model and why.** `gpt-4.1-mini-2025-04-14`, the only model with 50/50 exact on 5 runs of the samples. gpt-5 minis: 45/50; Gemini Flash: 6–21 s; Flash-Lite: dropped cities. Search p95: 1.4–2.1 s.

**Cost per search.** **≈ $0.0005**: ~3,100 input tokens (2,944 from the prompt cache) and ~110 output, at $0.40 / $0.10 cached / $1.60 per million. Cold cache ≈ $0.0014; paging and chip edits are free.

**Tradeoffs.**
- *A fixed order, not relevance ranking:* broad briefs give long lists. Paging re-runs the query: fine at 5k rows, not at millions.
- *Security in the database:* RLS on every table, company-scoped keys, plan and quota changed only by `security definer` functions, no direct candidate access. More SQL to maintain.
- *Reserve, then refund:* one conditional `UPDATE` reserves the free search before the LLM call (20 at once → exactly 1); any failure refunds it. Free plan: 10 chip edits per search; paid: no cap.
- *Billing:* HMAC on the raw body, with dedup by event id and ordering by `event.created`, instead of a timestamp window (replayed events are old). `active` and `trialing` count as paid.

**What we would do with another week.** Ranking for broad briefs · a "did you mean" chip for near-miss values · Playwright UI tests in CI · a separate test database · alerts on saved searches.
