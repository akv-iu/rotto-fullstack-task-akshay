import 'server-only';
import { cleanFilters, type Filters } from '@/lib/shared/filters';
import type { Ctx } from './auth';
import { HttpError, must, requireUuid } from './http';
import { briefToFilters, llmConfigured } from './llm';
import { adminClient } from './supabase';

export type CandidateCard = {
  id: string; full_name: string; avatar_url: string; headline: string; current_title: string; current_company: string;
  city: string; years_experience: number; open_to_work: boolean; skills: string[];
};
export type SearchResponse = { search_id: string; filters: Filters; total: number; results: CandidateCard[]; searches_remaining: number | null };
export type PageResponse = { search_id: string; page: number; filters: Filters; total: number; results: CandidateCard[] };

const PAGE_SIZE = 20;
const NOT_COUNTED = "The search didn't go through. It wasn't counted against your plan. Please try again.";
const NOT_SURE = "The search didn't go through. Please try again in a moment.";
type Clean = { filters: Filters; runnable: boolean };

export async function getPlan(ctx: Ctx): Promise<{ plan: 'free' | 'paid'; searches_remaining: number | null }> {
  const c = must(await ctx.db.from('companies').select('plan, searches_used').eq('id', ctx.companyId).single())!; // .single() errors (→ 500) if the row is missing
  return c.plan === 'paid'
    ? { plan: 'paid', searches_remaining: null }
    : { plan: 'free', searches_remaining: Math.max(0, 1 - c.searches_used) };
}

// Recruiters can't query candidates themselves (that would skip the free-plan limit), so the search runs with the
// server's key. Every caller has already checked the recruiter and that the search belongs to their company.
async function runPage(_ctx: Ctx, clean: Clean, page: number): Promise<{ total: number; results: CandidateCard[] }> {
  if (!clean.runnable) return { total: 0, results: [] };
  return must(await adminClient().rpc('search_candidates', { f: clean.filters, lim: PAGE_SIZE, off: (page - 1) * PAGE_SIZE }));
}

async function firstPage(ctx: Ctx, searchId: string, clean: Clean): Promise<SearchResponse> {
  const [page, plan] = await Promise.all([runPage(ctx, clean, 1), getPlan(ctx)]);
  return { search_id: searchId, filters: clean.filters, ...page, searches_remaining: plan.searches_remaining };
}

async function reserve(ctx: Ctx, brief: string): Promise<string> {
  const id = must(await ctx.db.rpc('reserve_search', { p_brief: brief })) as string | null;
  if (!id) throw new HttpError(402, "You've used your free search. Upgrade to run new searches.");
  return id;
}

/**
 * Runs page 1 and reads the plan BEFORE marking the search done, so every step that can fail happens while the
 * search is still refundable. complete_search is the last statement: after it, nothing else can fail.
 */
async function finish(ctx: Ctx, id: string, clean: Clean): Promise<SearchResponse> {
  try {
    const response = await firstPage(ctx, id, clean);
    const ok = must(await ctx.db.rpc('complete_search', { p_search: id, p_filters: clean.filters }));
    if (!ok) throw new Error('complete_search did not update the search');
    return response;
  } catch (e) {
    return refund(ctx, id, e);
  }
}

/** Server-only refund (recruiters can't call it). Promises "not counted" only when the refund really applied. */
async function refund(ctx: Ctx, id: string, cause: unknown): Promise<never> {
  console.error('search failed, refunding', id, cause);
  const r = await adminClient().rpc('refund_search', { p_search: id, p_company: ctx.companyId }).then((x) => x, (e) => ({ data: null, error: e }));
  if (r.error || r.data !== true) {
    console.error('refund did not apply', id, r.error?.message);
    throw new HttpError(502, NOT_SURE);
  }
  throw new HttpError(502, NOT_COUNTED);
}

/** New search: the only path that calls the AI. Any failure after the reservation refunds it. */
export async function newSearch(ctx: Ctx, brief: string): Promise<SearchResponse> {
  const text = brief.trim();
  if (!text || text.length > 500) throw new HttpError(400, 'Describe who you are looking for in 1 to 500 characters.');
  if (!llmConfigured()) throw new HttpError(503, 'Search is not set up on this server yet.');
  const id = await reserve(ctx, text);
  let clean: Clean | null;
  try {
    clean = cleanFilters(await briefToFilters(text));
  } catch (e) {
    return refund(ctx, id, e);
  }
  if (!clean) return refund(ctx, id, new Error('model output was not an object'));
  return finish(ctx, id, clean);
}

/** Correction: no AI, no quota; 10 per original search on the free plan, no cap on paid. */
export async function correctSearch(ctx: Ctx, parentId: string, rawFilters: unknown): Promise<SearchResponse> {
  requireUuid(parentId, 'search');
  const clean = cleanFilters(rawFilters);
  if (!clean) throw new HttpError(400, 'The filters must be a JSON object.');
  // Results first, then record the edit: a failed page query uses none of the 10 edits.
  const [page, plan] = await Promise.all([runPage(ctx, clean, 1), getPlan(ctx)]);
  const r = must(await ctx.db.rpc('create_correction', { p_parent: parentId, p_filters: clean.filters })) as { id?: string; error?: string };
  if (r.error === 'not_found') throw new HttpError(404, 'That search was not found.');
  if (r.error === 'cap') throw new HttpError(429, "The free plan allows 10 filter changes per search, and this one has used them. Upgrade to keep refining.");
  return { search_id: r.id!, filters: clean.filters, ...page, searches_remaining: plan.searches_remaining };
}

/** Saved re-run: the server loads the stored filters (never the browser's); no AI; uses a search. */
export async function rerunSaved(ctx: Ctx, savedId: string): Promise<SearchResponse> {
  requireUuid(savedId, 'saved search');
  const saved = must(await ctx.db.from('saved_briefs').select('brief, filters').eq('id', savedId).maybeSingle());
  if (!saved) throw new HttpError(404, 'That saved search was not found.');
  const clean = cleanFilters(saved.filters) ?? { filters: {}, runnable: false };
  return finish(ctx, await reserve(ctx, saved.brief), clean);
}

/** Paging: never counts as a search; stored filters are re-checked on every read. */
export async function getPage(ctx: Ctx, searchId: string, pageParam: string | null): Promise<PageResponse> {
  const page = pageParam === null ? 1 : Number(pageParam);
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new HttpError(400, 'The page must be a whole number from 1.');
  requireUuid(searchId, 'search');
  const s = must(await ctx.db.from('searches').select('filters, status').eq('id', searchId).maybeSingle());
  if (!s || s.status !== 'ready') throw new HttpError(404, 'That search was not found.');
  const clean = cleanFilters(s.filters) ?? { filters: {}, runnable: false };
  return { search_id: searchId, page, filters: clean.filters, ...(await runPage(ctx, clean, page)) };
}
