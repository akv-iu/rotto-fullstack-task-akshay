import 'server-only';
import { cleanFilters } from '@/lib/shared/filters';
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
  const rows = must(await ctx.db.from('shortlists').select('id, name, shortlist_members(candidate_id)').order('created_at')) ?? [];
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
  const rows = must(await ctx.db.from('shortlists').delete().eq('id', id).select('id')) ?? [];
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

export async function listSaved(ctx: Ctx) {
  return must(await ctx.db.from('saved_briefs').select('id, brief, filters, created_at').order('created_at', { ascending: false }));
}

export async function createSaved(ctx: Ctx, body: Record<string, unknown>) {
  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  if (brief.length < 1 || brief.length > 500) throw new HttpError(400, 'A saved search needs a brief of 1 to 500 characters.');
  const clean = cleanFilters(body.filters);
  if (!clean) throw new HttpError(400, 'The filters must be a JSON object.'); // contract: filters is any object
  const row = must(await ctx.db.from('saved_briefs').insert({ company_id: ctx.companyId, brief, filters: clean.filters }).select('id').single())!; // .single() errors (→ 500) if nothing came back
  return { id: row.id as string };
}

export async function deleteSaved(ctx: Ctx, id: string) {
  requireUuid(id, 'saved search');
  const rows = must(await ctx.db.from('saved_briefs').delete().eq('id', id).select('id')) ?? [];
  if (!rows.length) throw new HttpError(404, 'That saved search was not found.');
  return { ok: true as const };
}

export async function getPerson(_ctx: Ctx, id: string) {
  requireCandidateId(id);
  const row = must(await candidates().select('profile').eq('id', id).maybeSingle());
  if (!row) throw new HttpError(404, 'That candidate was not found.');
  return row.profile;
}
