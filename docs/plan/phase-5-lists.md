# Phase 5: Shortlists, saved searches, people

> **In short:** Adds the shortlist, saved-search and candidate-profile routes on top of the same database security rules.
> Every route is also attacked from the other company's account and must answer 404 while leaving the other company's data untouched.

Goal: the rest of the contract, plus our additive routes, each tested from the attacker's side as well. Covers the security 10 (via the API) and the "obvious how to shortlist / save" UI checks.

---

### Task 11: Shortlist routes

**Files:**
- Create: `lib/server/lists.ts`, `app/api/shortlists/route.ts`, `app/api/shortlists/[id]/route.ts`, `app/api/shortlists/[id]/people/[personId]/route.ts`
- Test: `tests/shortlists-api.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `requireRecruiter` (Task 8); `HttpError`, `must`, `requireUuid`, `route`, `json`, `readJson` (Task 8); `CandidateCard` (Task 8).
- Produces:
  - `listShortlists(ctx) → { id, name, count, candidate_ids: string[] }[]`
  - `createShortlist(ctx, name: unknown) → { id }`
  - `getShortlist(ctx, id) → { id, name, people: CandidateCard[] }`
  - `renameShortlist(ctx, id, name: unknown) → { id }`; `deleteShortlist(ctx, id) → { ok: true }`
  - `addMember(ctx, listId, personId) → { ok: true }`; `removeMember(ctx, listId, personId) → { ok: true }`
  - `requireCandidateId(id)` (400 unless `^cand_\d{4}$`)

- [ ] **Step 1: Write the failing test `tests/shortlists-api.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, signIn } from './helpers';

let acme: string, globex: string, globexList: string;

beforeEach(async () => {
  const db = admin();
  await db.from('shortlists').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  globexList = (await db.from('shortlists').insert({ company_id: COMPANY.globex, name: 'Globex list' }).select('id').single()).data!.id;
  await db.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.globex, candidate_id: 'cand_0001' });
  [acme, globex] = await Promise.all([signIn('acme'), signIn('globex')]);
});

describe('shortlists (contract)', () => {
  it('create returns 200 { id }, then it is listed with its members', async () => {
    const created = await api(acme, 'POST', '/api/shortlists', { name: '  Frontend NYC  ' });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api(acme, 'POST', `/api/shortlists/${created.body.id}/people/cand_0629`)).status).toBe(200);
    const list = await api(acme, 'GET', '/api/shortlists');
    expect(list.body).toEqual([{ id: created.body.id, name: 'Frontend NYC', count: 1, candidate_ids: ['cand_0629'] }]);
  });

  it('adding someone already on the list changes nothing; removing is idempotent too', async () => {
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'A' })).body;
    for (let i = 0; i < 3; i++) expect((await api(acme, 'POST', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.people.map((p: { id: string }) => p.id)).toEqual(['cand_0883']);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.people).toEqual([]);
  });

  it('validates names (400), rejects duplicates (409), renames and deletes', async () => {
    expect((await api(acme, 'POST', '/api/shortlists', { name: '   ' })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/shortlists', {})).status).toBe(400);
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'Dupes' })).body;
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'Dupes' })).status).toBe(409);
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'Globex list' })).status).toBe(200); // names are per company
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: 'Renamed' })).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.name).toBe('Renamed');
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: 'Globex list' })).status).toBe(409); // rename onto a taken name
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: ' ' })).status).toBe(400);
    expect((await api(acme, 'PATCH', '/api/shortlists/not-a-uuid', { name: 'x' })).status).toBe(400);
    expect((await api(acme, 'DELETE', '/api/shortlists/not-a-uuid')).status).toBe(400);
    await api(acme, 'POST', `/api/shortlists/${id}/people/cand_0001`);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).status).toBe(404);
    // Deleting a list removes its members too (FR-6.6).
    expect((await admin().from('shortlist_members').select('candidate_id').eq('shortlist_id', id)).data).toEqual([]);
  });

  it('unknown candidate 404, malformed IDs 400, no token 401', async () => {
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'B' })).body;
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/cand_9999`)).status).toBe(404);
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/robert'); drop table--`)).status).toBe(400);
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/%25`)).status).toBe(400); // odd encoding: 400, never a crash
    expect((await api(acme, 'GET', '/api/shortlists/not-a-uuid')).status).toBe(400);
    expect((await api(null, 'GET', '/api/shortlists')).status).toBe(401);
  });
});

describe('acme cannot read or change globex shortlists through the API', () => {
  it('every attempt is 404 (or absent) and globex is untouched', async () => {
    expect(JSON.stringify((await api(acme, 'GET', '/api/shortlists')).body)).not.toContain(globexList);
    expect((await api(acme, 'GET', `/api/shortlists/${globexList}`)).status).toBe(404);
    expect((await api(acme, 'PATCH', `/api/shortlists/${globexList}`, { name: 'pwned' })).status).toBe(404);
    expect((await api(acme, 'POST', `/api/shortlists/${globexList}/people/cand_0002`)).status).toBe(404);
    expect((await api(acme, 'DELETE', `/api/shortlists/${globexList}/people/cand_0001`)).status).toBe(404);
    expect((await api(acme, 'DELETE', `/api/shortlists/${globexList}`)).status).toBe(404);
    const g = await api(globex, 'GET', `/api/shortlists/${globexList}`);
    expect(g.body).toMatchObject({ name: 'Globex list' });
    expect(g.body.people.map((p: { id: string }) => p.id)).toEqual(['cand_0001']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/shortlists-api.test.ts`
Expected: FAIL with 404s (routes don't exist).

- [ ] **Step 3: Write `lib/server/lists.ts` (shortlist part)**

```ts
import 'server-only';
import type { Ctx } from './auth';
import { HttpError, must, requireUuid } from './http';
import type { CandidateCard } from './search';
import { adminClient } from './supabase';

const CARD = 'id, full_name, avatar_url, headline, current_title, current_company, city, years_experience, open_to_work, skills';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

// Candidates are read with the server's key: recruiters have no direct access to the table (Task 4).
// Every caller has already checked the recruiter, and candidates are shared by all companies (X2).
const candidates = () => adminClient().from('candidates');

export function requireCandidateId(id: string) {
  if (!/^cand_\d{4}$/.test(id)) throw new HttpError(400, 'That candidate ID is not valid.');
}

function validName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > 80) throw new HttpError(400, 'Give the list a name of 1 to 80 characters.');
  return n;
}

const duplicate = (error: { code?: string } | null) => {
  if (error?.code === UNIQUE_VIOLATION) throw new HttpError(409, 'You already have a list with that name.');
};

/** 404 unless the list exists AND belongs to the caller's company (RLS hides other companies' lists). */
async function requireOwnList(ctx: Ctx, id: string) {
  requireUuid(id, 'list');
  const list = must(await ctx.db.from('shortlists').select('id').eq('id', id).maybeSingle());
  if (!list) throw new HttpError(404, 'That list was not found.');
}

export async function listShortlists(ctx: Ctx) {
  const rows = must(await ctx.db.from('shortlists').select('id, name, shortlist_members(candidate_id)').order('created_at'));
  return rows.map((r) => {
    const ids = (r.shortlist_members as { candidate_id: string }[]).map((m) => m.candidate_id);
    return { id: r.id as string, name: r.name as string, count: ids.length, candidate_ids: ids };
  });
}

export async function createShortlist(ctx: Ctx, name: unknown) {
  const { data, error } = await ctx.db.from('shortlists').insert({ company_id: ctx.companyId, name: validName(name) }).select('id').single();
  duplicate(error);
  if (error) throw new Error(error.message);
  return { id: data.id as string };
}

export async function getShortlist(ctx: Ctx, id: string) {
  requireUuid(id, 'list');
  // The list and its members through RLS (own company only); then the people's cards with the server's key.
  const row = must(await ctx.db.from('shortlists').select('id, name, shortlist_members(added_at, candidate_id)').eq('id', id).maybeSingle());
  if (!row) throw new HttpError(404, 'That list was not found.');
  const members = row.shortlist_members as { added_at: string; candidate_id: string }[];
  members.sort((a, b) => b.added_at.localeCompare(a.added_at));
  const cards = members.length ? must(await candidates().select(CARD).in('id', members.map((m) => m.candidate_id))) as unknown as CandidateCard[] : [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  return { id: row.id as string, name: row.name as string, people: members.map((m) => byId.get(m.candidate_id)!) };
}

export async function renameShortlist(ctx: Ctx, id: string, name: unknown) {
  requireUuid(id, 'list');
  const { data, error } = await ctx.db.from('shortlists').update({ name: validName(name) }).eq('id', id).select('id').maybeSingle();
  duplicate(error);
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'That list was not found.');
  return { id };
}

export async function deleteShortlist(ctx: Ctx, id: string) {
  requireUuid(id, 'list');
  const rows = must(await ctx.db.from('shortlists').delete().eq('id', id).select('id'));
  if (!rows.length) throw new HttpError(404, 'That list was not found.');
  return { ok: true as const };
}

export async function addMember(ctx: Ctx, listId: string, personId: string) {
  requireCandidateId(personId);
  await requireOwnList(ctx, listId);
  const person = must(await candidates().select('id').eq('id', personId).maybeSingle());
  if (!person) throw new HttpError(404, 'That candidate was not found.');
  const { error } = await ctx.db.from('shortlist_members').upsert(
    { shortlist_id: listId, company_id: ctx.companyId, candidate_id: personId },
    { onConflict: 'shortlist_id,candidate_id', ignoreDuplicates: true },
  );
  if (error?.code === FK_VIOLATION) throw new HttpError(404, 'That list was not found.'); // deleted a moment ago
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

export async function removeMember(ctx: Ctx, listId: string, personId: string) {
  requireCandidateId(personId);
  await requireOwnList(ctx, listId);
  must(await ctx.db.from('shortlist_members').delete().eq('shortlist_id', listId).eq('candidate_id', personId));
  return { ok: true as const };
}
```

- [ ] **Step 4: Write the routes**

`app/api/shortlists/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { createShortlist, listShortlists } from '@/lib/server/lists';

export const GET = route(async (req) => json(await listShortlists(await requireRecruiter(req))));

export const POST = route(async (req) => {
  const ctx = await requireRecruiter(req);
  return json(await createShortlist(ctx, (await readJson(req)).name));
});
```

`app/api/shortlists/[id]/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { deleteShortlist, getShortlist, renameShortlist } from '@/lib/server/lists';

type P = { id: string };

export const GET = route<P>(async (req, { params }) => json(await getShortlist(await requireRecruiter(req), (await params).id)));

export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await requireRecruiter(req);
  return json(await renameShortlist(ctx, (await params).id, (await readJson(req)).name));
});

export const DELETE = route<P>(async (req, { params }) => json(await deleteShortlist(await requireRecruiter(req), (await params).id)));
```

`app/api/shortlists/[id]/people/[personId]/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { addMember, removeMember } from '@/lib/server/lists';

type P = { id: string; personId: string };

export const POST = route<P>(async (req, { params }) => {
  const { id, personId } = await params;
  return json(await addMember(await requireRecruiter(req), id, personId));
});

export const DELETE = route<P>(async (req, { params }) => {
  const { id, personId } = await params;
  return json(await removeMember(await requireRecruiter(req), id, personId));
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/shortlists-api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/lists.ts app/api/shortlists tests/shortlists-api.test.ts
git commit -m "feat: shortlist routes with cross-company protection"
```

---

### Task 12: Saved searches and the candidate profile

**Files:**
- Modify: `lib/server/lists.ts` (append)
- Create: `app/api/saved-briefs/route.ts`, `app/api/saved-briefs/[id]/route.ts`, `app/api/people/[id]/route.ts`
- Test: `tests/saved-people-api.test.ts`

**Interfaces:**
- Consumes: `cleanFilters` (Task 6), Task 11 helpers.
- Produces: `listSaved(ctx)`, `createSaved(ctx, body)`, `deleteSaved(ctx, id)`, `getPerson(ctx, id)` (returns the original candidate record).

- [ ] **Step 1: Write the failing test `tests/saved-people-api.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, signIn } from './helpers';

let acme: string, globexSaved: string;

beforeEach(async () => {
  const db = admin();
  await db.from('saved_briefs').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  globexSaved = (await db.from('saved_briefs').insert({ company_id: COMPANY.globex, brief: 'globex brief', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
  acme = await signIn('acme');
});

describe('saved searches', () => {
  it('saves cleaned filters and lists them newest first', async () => {
    const a = await api(acme, 'POST', '/api/saved-briefs', { brief: 'phd ds', filters: { roles: ['Data Scientist'], degrees: ['PhD'] } });
    expect(a.status).toBe(200);
    const b = await api(acme, 'POST', '/api/saved-briefs', { brief: 'london', filters: { cities: ['London'] } });
    const list = (await api(acme, 'GET', '/api/saved-briefs')).body;
    expect(list.map((s: { id: string }) => s.id)).toEqual([b.body.id, a.body.id]);
    expect(list[1]).toMatchObject({ brief: 'phd ds', filters: { roles: ['Data Scientist'], degrees: ['PhD'] } });
    expect(list[0].filters).toEqual({ unsupported: [{ text: 'London', reason: 'unsupported' }] });
  });

  it('400 for a bad body; delete is own-company only', async () => {
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: '', filters: {} })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: 'x', filters: 'roles' })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: 'x' })).status).toBe(400);
    expect(JSON.stringify((await api(acme, 'GET', '/api/saved-briefs')).body)).not.toContain(globexSaved);
    expect((await api(acme, 'DELETE', `/api/saved-briefs/${globexSaved}`)).status).toBe(404);
    expect((await api(acme, 'DELETE', '/api/saved-briefs/not-a-uuid')).status).toBe(400);
    expect((await api(null, 'GET', '/api/saved-briefs')).status).toBe(401);
    expect((await admin().from('saved_briefs').select('id').eq('id', globexSaved)).data).toHaveLength(1);
    const { id } = (await api(acme, 'POST', '/api/saved-briefs', { brief: 'x', filters: { roles: ['Recruiter'] } })).body;
    expect((await api(acme, 'DELETE', `/api/saved-briefs/${id}`)).status).toBe(200);
  });
});

describe('GET /api/people/{id}', () => {
  it('returns experience, education and skills; 404 unknown; 400 malformed; 401 signed out', async () => {
    const r = await api(acme, 'GET', '/api/people/cand_1634');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'cand_1634', full_name: 'Felix Walsh' });
    expect(r.body.experiences.length).toBeGreaterThan(0);
    expect(r.body.education.length).toBeGreaterThan(0);
    expect(r.body.skills).toContain('React');
    expect((await api(acme, 'GET', '/api/people/cand_9999')).status).toBe(404);
    expect((await api(acme, 'GET', '/api/people/1%20or%201=1')).status).toBe(400);
    expect((await api(acme, 'GET', '/api/people/%25')).status).toBe(400);
    expect((await api(null, 'GET', '/api/people/cand_1634')).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/saved-people-api.test.ts`
Expected: FAIL with 404s.

- [ ] **Step 3: Append to `lib/server/lists.ts`**

```ts
import { cleanFilters } from '@/lib/shared/filters';

export async function listSaved(ctx: Ctx) {
  return must(await ctx.db.from('saved_briefs').select('id, brief, filters, created_at').order('created_at', { ascending: false }));
}

export async function createSaved(ctx: Ctx, body: Record<string, unknown>) {
  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  if (brief.length < 1 || brief.length > 500) throw new HttpError(400, 'A saved search needs a brief of 1 to 500 characters.');
  const clean = cleanFilters(body.filters);
  if (!clean) throw new HttpError(400, 'The filters must be a JSON object.'); // contract: filters is any object
  const row = must(await ctx.db.from('saved_briefs').insert({ company_id: ctx.companyId, brief, filters: clean.filters }).select('id').single());
  return { id: row.id as string };
}

export async function deleteSaved(ctx: Ctx, id: string) {
  requireUuid(id, 'saved search');
  const rows = must(await ctx.db.from('saved_briefs').delete().eq('id', id).select('id'));
  if (!rows.length) throw new HttpError(404, 'That saved search was not found.');
  return { ok: true as const };
}

export async function getPerson(_ctx: Ctx, id: string) {
  requireCandidateId(id);
  const row = must(await candidates().select('profile').eq('id', id).maybeSingle());
  if (!row) throw new HttpError(404, 'That candidate was not found.');
  return row.profile;
}
```
(Move the new `cleanFilters` import to the top of the file with the other imports.)

- [ ] **Step 4: Write the routes**

`app/api/saved-briefs/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { createSaved, listSaved } from '@/lib/server/lists';

export const GET = route(async (req) => json(await listSaved(await requireRecruiter(req))));

export const POST = route(async (req) => {
  const ctx = await requireRecruiter(req);
  return json(await createSaved(ctx, await readJson(req)));
});
```

`app/api/saved-briefs/[id]/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { deleteSaved } from '@/lib/server/lists';

export const DELETE = route<{ id: string }>(async (req, { params }) =>
  json(await deleteSaved(await requireRecruiter(req), (await params).id)));
```

`app/api/people/[id]/route.ts`:
```ts
import { requireRecruiter } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { getPerson } from '@/lib/server/lists';

export const GET = route<{ id: string }>(async (req, { params }) =>
  json(await getPerson(await requireRecruiter(req), (await params).id)));
```

- [ ] **Step 5: Run the tests, then the whole suite**

```bash
npm test -- tests/saved-people-api.test.ts
npm test
```
Expected: PASS. The full suite is now the API's safety net for the UI phase.

- [ ] **Step 6: Commit**

```bash
git add lib/server/lists.ts app/api/saved-briefs app/api/people tests/saved-people-api.test.ts
git commit -m "feat: saved searches and candidate profile routes"
```

---

## Requirements check (plan review, 2026-10-07)

An independent reviewer checked this phase against TECH_REQUIREMENTS, SCORING, SPEC, ARCHITECTURE and DESIGN. I verified each finding against those docs before accepting or rejecting it.

| Requirement | Where in this phase | Proof |
|---|---|---|
| TECH §3 / §3a: shortlist, saved-brief and people routes with exact shapes | Tasks 11–12 | `tests/shortlists-api.test.ts`, `tests/saved-people-api.test.ts` |
| X1 through the API: the other company's lists and saved searches → 404, unchanged | RLS + `requireOwnList` | cross-company tests read globex's data back afterwards |
| FR-5.2: malformed id → 400, unknown → 404 | `requireCandidateId`, `requireUuid` | includes `%25`, SQL-ish ids, bad UUIDs |
| FR-6.5 / FR-6.6: duplicates 409, idempotent add, delete removes members | upsert + unique constraints + cascade | rename-to-taken-name 409, cascade check |
| F3 / FR-5.1: profile shows experience, education, skills | `getPerson` returns the original record | people test |

**Changed after review:** removed a second URL-decode that turned `/api/people/%25` into a 500 (now 400); a list deleted mid-add gives 404, not 500; added tests for rename 409/400, bad UUIDs on PATCH/DELETE, the member cascade, and 401 on saved searches.

**Rejected:** a 400 when saving a search that can't return anyone. The contract says `filters` is any object, so a grader's odd filters must still save. The UI disables "Save search" for such searches instead.

**Verdict:** ready to implement.
