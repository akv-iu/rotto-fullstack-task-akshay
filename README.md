# Rotto: plain-English candidate search

**Run** (Docker Desktop running, Node 24): `export OPENAI_API_KEY=… STRIPE_WEBHOOK_SECRET=…`, then `make setup && make dev` → http://localhost:3000. Sign in as `recruiter@acme.test` or `recruiter@globex.test` / `rotto-assessment`. `make test` runs all 114 tests.

**How search works.** One LLM call turns the brief into filter JSON; no candidate data is sent. Code re-checks every value against the data. One fixed, parameterized SQL function returns exact matches, 20 per page in a stable order; paging never uses a search (p95 34–69 ms). Editing a chip re-runs without the LLM or a search. The samples are exact filter matches, so precision comes from correct filters: all 10 return exactly the right people.

**How invented filters are prevented.** Strict structured output with the real values as enums: the model can't name a city or skill we don't have. Anything it can't map ("speaks Japanese", "experienced") becomes an amber chip and the search returns **nobody**, not the wrong people. No real conditions (vague, hostile or injection briefs) → nobody, never everyone, enforced in code and again in SQL.

**The model and why.** `gpt-4.1-mini-2025-04-14`, the only model with 50/50 exact on 5 runs of the samples. gpt-5 minis: 45/50 (a wrong "Frontend" role on "React engineers"); Gemini Flash: 6–21 s; Flash-Lite: dropped cities. Search p95: 1.5–2.1 s with the LLM.

**Cost per search.** **≈ $0.0004**: ~2,200 input tokens (2,048 from the prompt cache) and ~90 output, at $0.40 / $0.10 cached / $1.60 per million. Cold cache ≈ $0.001; paging and chip edits are free.

**Tradeoffs.**
- *Exact matching, not ranking:* precise and explainable, but broad briefs get long, flatly ordered lists. Paging re-runs the query: fine at 5k rows, not at millions.
- *Empty rather than wrong:* one unsupported condition returns nobody until its chip is removed.
- *Security in the database:* RLS on every table, company-scoped keys, plan and quota changed only by `security definer` functions, no direct candidate access. More SQL to maintain.
- *Reserve, then refund:* one conditional `UPDATE` reserves the free search before the LLM call (20 at once → exactly 1); any failure refunds it.
- *Billing:* HMAC on the raw body, with dedup by event id and ordering by `event.created`, instead of a timestamp window (replayed events are old).

**What we would do with another week.** Ranking for broad briefs · a "did you mean" chip for near-miss values · Playwright UI tests in CI · a separate test database · alerts on saved searches.
