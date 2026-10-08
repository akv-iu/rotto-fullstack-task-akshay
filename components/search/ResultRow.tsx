'use client';
import type { CandidateCard } from '@/lib/server/search';
import type { Filters } from '@/lib/shared/filters';
import { Avatar, cx } from '@/components/ui';

export function ResultRow({ candidate: c, filters, selected, onOpen, action }: {
  candidate: CandidateCard; filters: Filters; selected: boolean; onOpen: () => void; action?: React.ReactNode;
}) {
  const wanted = new Set([...(filters.skills ?? []), ...(filters.any_skills ?? [])]);
  const skills = [...c.skills].sort((a, b) => Number(wanted.has(b)) - Number(wanted.has(a))).slice(0, 4);
  return (
    <li className={cx('flex items-center gap-3 border-t border-line bg-surface px-4 py-3', selected && 'bg-accent-soft/50 shadow-[inset_2px_0_0_var(--accent)]')}>
      <button type="button" onClick={onOpen} aria-label={`Open ${c.full_name}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar src={c.avatar_url} name={c.full_name} className="size-9" />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-medium">{c.full_name}</span>
            {c.open_to_work && <span className="rounded bg-accent-soft px-1.5 text-xs text-accent">Open to work</span>}
          </span>
          <span className="block truncate text-sm text-muted">{c.current_title} at {c.current_company} · {c.city}, {c.years_experience} yrs</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {skills.map((s) => (
              <span key={s} className={cx('rounded px-1.5 text-xs', wanted.has(s) ? 'bg-accent-soft font-medium text-accent' : 'bg-line text-muted')}>{s}</span>
            ))}
          </span>
        </span>
      </button>
      {action}
    </li>
  );
}
