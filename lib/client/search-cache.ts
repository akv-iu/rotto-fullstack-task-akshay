import type { CandidateCard, SearchResponse } from '@/lib/server/search';

/**
 * The search screen as the recruiter left it, kept in memory while they visit Shortlists or Saved searches, so the
 * Search tab comes back instantly with every loaded row and the same scroll position. A full reload starts empty
 * (the page then re-reads page 1, which never uses a search). Cleared on sign-out so another company never sees it.
 */
export type SearchSnapshot = {
  result: SearchResponse; rows: CandidateCard[]; page: number; brief: string; searchedBrief: string; scrollY: number;
};

let snapshot: SearchSnapshot | null = null;

export const searchCache = {
  get: () => snapshot,
  set: (s: SearchSnapshot) => { snapshot = s; },
  clear: () => {
    snapshot = null;
    try { sessionStorage.removeItem('lastSearch'); } catch {}
  },
};
