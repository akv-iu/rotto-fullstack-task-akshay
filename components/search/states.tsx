'use client';
import { Warning } from '@phosphor-icons/react';
import type { Filters } from '@/lib/shared/filters';
import { Button, Skeleton } from '@/components/ui';
import { chipsOf } from './chip-model';

const EXAMPLES = [
  'senior React engineers in New York who have worked at a startup',
  'data scientists with a PhD',
  'product designers in San Francisco open to work',
];

export function FirstVisit({ onPick, freeLeft }: { onPick: (brief: string) => void; freeLeft: number | null }) {
  if (freeLeft === 0) return null; // the plan banner explains; examples would fill a disabled box
  return (
    <div className="mt-8 max-w-2xl">
      <h2 className="text-lg font-semibold">Describe the people you want, in plain English.</h2>
      <p className="mt-1 text-muted">Role, skills, city, seniority, experience, education. For example:</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Fills the box; never runs it, so a free user can't spend their search by accident. */}
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:border-accent">{e}</button>
        ))}
      </div>
      {freeLeft !== null && <p className="mt-4 text-sm text-muted">Free plan: {freeLeft} {freeLeft === 1 ? 'search' : 'searches'} included.</p>}
    </div>
  );
}

export function RowSkeletons({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden className="mt-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 border-t border-line px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <span className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-72 max-w-full" /></span>
        </li>
      ))}
    </ul>
  );
}

export function SearchingSkeleton() {
  return (
    <div aria-live="polite" className="mt-4">
      <div className="flex gap-2"><Skeleton className="h-7 w-24 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-7 w-28 rounded-full" /></div>
      <p className="mt-3 text-sm text-muted">Reading your brief…</p>
      <RowSkeletons />
    </div>
  );
}

export function ErrorBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-4 flex gap-3 rounded-xl bg-danger-soft p-4 text-danger">
      <Warning size={20} className="mt-0.5 shrink-0" />
      <div>
        <p>{message}</p>
        {onRetry && <Button className="mt-3" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}

export function NoResults({ filters, onClear }: { filters: Filters; onClear: () => void }) {
  const chips = chipsOf(filters);
  const blocked = chips.filter((c) => c.kind === 'unsupported');
  const real = chips.length - blocked.length;
  let title: string, body: string;
  if (blocked.length) {
    title = "Part of your brief isn't in our data, so we're not guessing.";
    body = 'Remove the highlighted filter to see results without it.';
  } else if (real === 0) {
    title = "There's nothing to search for yet.";
    body = 'We found no role, skill, city, seniority, experience or education in that. Add a filter, or describe who you want above.';
  } else {
    title = `No one matches all ${real} filters.`;
    body = "Remove a filter above to widen the search. Each change re-runs instantly and doesn't use a search.";
  }
  return (
    <div className="mt-6 max-w-xl">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      {real > 0 && !blocked.length && <Button className="mt-4" onClick={onClear}>Clear filters</Button>}
    </div>
  );
}
