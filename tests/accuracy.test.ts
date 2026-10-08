import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, signIn } from './helpers';

const scores: { precision: number; recall: number; p20: number }[] = [];
// The "baseline / best eval score" for SCORING.md and the README: the mean over every sample.
afterAll(() => {
  if (!scores.length) return;
  const mean = (k: 'precision' | 'recall' | 'p20') => scores.reduce((a, s) => a + s[k], 0) / scores.length;
  const p = mean('precision'), r = mean('recall');
  console.log(`MEAN over ${scores.length} samples: P=${p.toFixed(3)} R=${r.toFixed(3)} F1=${(p + r ? (2 * p * r) / (p + r) : 0).toFixed(3)} P@20=${mean('p20').toFixed(3)}`);
});

const hasKey = Boolean(process.env.OPENAI_API_KEY);
const samples: { brief: string; expected_ids: string[] }[] = JSON.parse(readFileSync('data/queries.json', 'utf8'));
const extra: { brief: string; expect?: Record<string, unknown>; zero?: boolean }[] = JSON.parse(readFileSync('tests/briefs.extra.json', 'utf8'));

let token: string;
// Row counts before any brief runs. Searches only ever add `searches` rows, so every other table must end up identical.
const TABLES = ['candidates', 'companies', 'recruiters', 'shortlists', 'shortlist_members', 'saved_briefs', 'subscriptions', 'billing_events'];
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await admin().from(t).select('*', { count: 'exact', head: true })).count])));
let before: Record<string, unknown>;
beforeAll(async () => {
  before = await counts();
  await admin().from('companies').update({ plan: 'paid' }).eq('id', COMPANY.acme); // unlimited searches for the eval
  token = await signIn('acme');
});

/** Exactly what the grader does: POST, then page to the end. */
async function searchAll(brief: string) {
  const first = await api(token, 'POST', '/api/search', { brief });
  expect(first.status).toBe(200);
  const ids: string[] = first.body.results.map((c: { id: string }) => c.id);
  const page1 = [...ids];
  for (let page = 2; ids.length < first.body.total; page++) {
    const r = await api(token, 'GET', `/api/search/${first.body.search_id}?page=${page}`);
    if (!r.body?.results?.length) break; // never loop forever on a short page
    ids.push(...r.body.results.map((c: { id: string }) => c.id));
  }
  return { ids, page1, filters: first.body.filters, total: first.body.total };
}

const sorted = (o: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])));

describe.runIf(hasKey)('accuracy (the grader\'s method)', () => {
  it.each(samples)('sample: $brief', async ({ brief, expected_ids }) => {
    const { ids, page1 } = await searchAll(brief);
    const expected = new Set(expected_ids);
    const tp = ids.filter((id) => expected.has(id)).length;
    const precision = ids.length ? tp / ids.length : expected.size === 0 ? 1 : 0;
    const recall = expected.size ? tp / expected.size : ids.length === 0 ? 1 : 0;
    const p20 = page1.length ? page1.filter((id) => expected.has(id)).length / page1.length : expected.size === 0 ? 1 : 0;
    console.log(`P=${precision.toFixed(2)} R=${recall.toFixed(2)} P@20=${p20.toFixed(2)}  ${brief}`);
    scores.push({ precision, recall, p20 });
    expect(new Set(ids).size).toBe(ids.length); // every result exactly once
    expect({ precision, recall }).toEqual({ precision: 1, recall: 1 });
  });

  it.each(extra)('extra: $brief', async ({ brief, expect: want, zero }) => {
    const { filters, total } = await searchAll(brief);
    if (zero) expect(total).toBe(0);
    else expect(sorted(filters)).toBe(sorted(want!));
  });

  it('hostile briefs changed no data (X4)', async () => {
    expect(await counts()).toEqual(before);
    expect(Object.values(before).every((n) => typeof n === 'number')).toBe(true); // a mistyped table would compare null to null
    expect(before.candidates).toBe(5000);
    expect((await admin().from('companies').select('slug').order('slug')).data).toEqual([{ slug: 'acme' }, { slug: 'globex' }]);
  });
});
