import type { ShortlistSummary } from './app-shell';

/** Which of the company's lists a person is on, and how the Shortlist button should say so. */
export function membership(lists: ShortlistSummary[], candidateId: string) {
  const ordered = lists
    .map((l) => ({ ...l, member: l.candidate_ids.includes(candidateId) }))
    .sort((a, b) => Number(b.member) - Number(a.member)); // their lists first; stable within each group
  const names = ordered.filter((l) => l.member).map((l) => l.name);
  const button = names.length === 0 ? 'Shortlist' : names.length === 1 ? names[0] : `${names.length} lists`;
  return { ordered, names, button, short: names.length ? String(names.length) : '' };
}
