'use client';
import * as Popover from '@radix-ui/react-popover';
import { CaretDown, Check, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useAppState } from './app-shell';
import { membership } from './shortlist-model';
import { Button, cx } from './ui';
import { api } from '@/lib/client/api';

/**
 * The button names the lists a person is on ("✓ Frontend NYC", "✓ 2 lists"), so it's clear both where they are and
 * that they can go on another list. The menu ticks their lists first and offers + on the rest. `block` (profile)
 * also writes the list names under the button.
 */
export function ShortlistButton({ candidateId, name, compact, block }: { candidateId: string; name: string; compact?: boolean; block?: boolean }) {
  const { lists, refreshLists } = useAppState();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false); // the lists couldn't be re-read: the ticks may be out of date
  const m = membership(lists ?? [], candidateId);
  const on = m.names.length > 0;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    // Always re-read the lists, also after a failure: a list created before the failure then shows up, ready to tap.
    await refresh();
    setBusy(false);
  }
  const refresh = () => refreshLists().then(() => setStale(false), () => setStale(true));
  const toggle = (listId: string, member: boolean) =>
    act(() => api(`/api/shortlists/${listId}/people/${candidateId}`, { method: member ? 'DELETE' : 'POST' }));
  const createAndAdd = () => act(async () => {
    const { id } = await api<{ id: string }>('/api/shortlists', { method: 'POST', body: { name: newName } });
    setNewName(''); // the list exists now: if adding fails, "try again" is a tap on it above, not a second create
    await api(`/api/shortlists/${id}/people/${candidateId}`, { method: 'POST' });
  });

  const label = on ? `${name} is on ${m.names.join(', ')}. Change lists` : `Shortlist ${name}`;
  return (
    <div className={cx(block && 'w-full')}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant={block ? 'primary' : on ? 'accent' : 'secondary'} aria-label={label}
            className={cx(block && 'w-full', compact && 'min-w-11 px-2 sm:max-w-44 sm:px-3')}>
            {on ? <Check size={14} weight="bold" className="shrink-0" /> : <Plus size={14} weight="bold" className="shrink-0" />}
            {/* Phone rows: just ✓ and the count. Elsewhere: the list name or "2 lists". */}
            {compact && <span className="sm:hidden">{m.short}</span>}
            <span className={cx('truncate', compact && 'hidden sm:inline')}>{block && on ? `On ${m.button}` : m.button}</span>
            {on && <CaretDown size={12} className="shrink-0 opacity-70" />}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} align="end" className="z-40 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
            <p className="px-2 pb-1 text-xs font-medium text-muted">
              {on ? `${name} is on ${m.names.length} ${m.names.length === 1 ? 'list' : 'lists'}. Tap to add or remove.` : `Add ${name} to`}
            </p>
            <ul>
              {m.ordered.map((l) => (
                <li key={l.id}>
                  <button type="button" disabled={busy} onClick={() => toggle(l.id, l.member)}
                    aria-label={`${l.member ? 'Remove from' : 'Add to'} ${l.name}`}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg md:min-h-0">
                    {l.member ? <Check size={14} weight="bold" className="shrink-0 text-accent" /> : <Plus size={14} className="shrink-0 text-muted" />}
                    <span className={cx('truncate', l.member && 'font-medium')}>{l.name}</span>
                  </button>
                </li>
              ))}
              {lists?.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No lists yet. Create one below.</li>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createAndAdd(); }} className="mt-2 flex gap-1.5 border-t border-line pt-2">
              <label htmlFor={`new-list-${candidateId}`} className="sr-only">New list name</label>
              <input id={`new-list-${candidateId}`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="New list"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm" />
              <Button type="submit" disabled={busy || !newName.trim()}>Add</Button>
            </form>
            {error && <p role="alert" className="px-2 pt-2 text-sm text-danger">{error}</p>}
            {stale && (
              <p role="alert" className="px-2 pt-2 text-sm text-danger">
                Couldn&apos;t refresh your lists, so these ticks may be out of date.{' '}
                <button type="button" onClick={refresh} disabled={busy} className="inline-flex min-h-11 items-center font-medium underline md:min-h-0">Try again</button>
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {block && on && <p className="mt-2 text-sm text-muted">On: {m.names.join(' · ')}</p>}
    </div>
  );
}
