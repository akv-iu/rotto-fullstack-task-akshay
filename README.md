# Rotto Recruiter Search

A small recruiter app. A recruiter describes the candidates they want in plain English. An LLM turns the brief into structured filters, and Postgres finds and ranks the matching candidates. Recruiters can correct the filters, view candidates, add them to named shortlists and save searches. Each company's data is kept separate, there is a free-plan search limit, and billing is driven by Stripe webhooks.

> **Status: spec approved (2026-10-07); implementation not started.** See:
> - [docs/TECH_REQUIREMENTS.md](docs/TECH_REQUIREMENTS.md): hard, non-negotiable technical constraints from the brief
> - [docs/SPEC.md](docs/SPEC.md): functional and non-functional requirements (approved)
> - [docs/SCORING.md](docs/SCORING.md): the grading rubric mapped to requirements and to our own checks, used to catch drift
> - [docs/NOTES.md](docs/NOTES.md): decision log and exploration findings
> - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, data model, request flows, setup and tests
> - [docs/DESIGN.md](docs/DESIGN.md): UI/UX decisions, research, and screenshots of the agreed design

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | Required |
| Runtime | Node.js **24** | Exact major is required |
| Framework | Next.js **16**, App Router | UI and API route handlers in one app |
| Database / Auth | Supabase (local, via Docker), Postgres + Supabase Auth | Supabase CLI **2.119.0** exactly; no hosted DB |
| Data access control | Postgres Row Level Security | Separates the two companies at the database level |
| LLM | **OpenAI `gpt-4.1-mini-2025-04-14`** (`OPENAI_API_KEY`), strict JSON schema | Only converts brief → filter JSON. SQL is one fixed, parameterized query in Postgres |
| Billing | Stripe **webhooks only** (simulated from `stripe-events.json`) | We never call Stripe |
| Task runner | `make setup`, `make dev` | Must run unattended on macOS (Apple Silicon) with Docker Desktop |

## Running (target, not yet implemented)

```bash
export OPENAI_API_KEY=...
export STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample
make setup   # install deps, start Supabase, migrate, seed companies/recruiters, load candidates.json
make dev     # http://localhost:3000
```

Seeded logins: `recruiter@acme.test` / `recruiter@globex.test`, password `rotto-assessment`.

<!-- The final README must fit on one page and cover: how search works, how invented filters are prevented,
     the chosen model and why, cost per search, tradeoffs, and what we would do with another week. -->
