'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useAppState } from './app-shell';
import { Button, cx } from './ui';
import { api } from '@/lib/client/api';

export function ShortlistButton({ candidateId, name, compact, block }: { candidateId: string; name: string; compact?: boolean; block?: boolean }) {
  const { lists, refreshLists } = useAppState();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = (lists ?? []).some((l) => l.candidate_ids.includes(candidateId));

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await refreshLists(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (listId: string, member: boolean) =>
    act(() => api(`/api/shortlists/${listId}/people/${candidateId}`, { method: member ? 'DELETE' : 'POST' }));
  const createAndAdd = () => act(async () => {
    const { id } = await api<{ id: string }>('/api/shortlists', { method: 'POST', body: { name: newName } });
    await api(`/api/shortlists/${id}/people/${candidateId}`, { method: 'POST' });
    setNewName('');
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant={block ? 'primary' : on ? 'accent' : 'secondary'} aria-label={`${on ? 'Shortlisted' : 'Shortlist'} ${name}`}
          className={cx(block && 'w-full', compact && 'size-11 px-0 sm:size-auto sm:px-3')}>
          {on ? <Check size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
          <span className={cx(compact && 'sr-only sm:not-sr-only')}>{on ? 'Shortlisted' : 'Shortlist'}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="end" className="z-40 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <p className="px-2 pb-1 text-xs font-medium text-muted">Add {name} to</p>
          <ul>
            {(lists ?? []).map((l) => {
              const member = l.candidate_ids.includes(candidateId);
              return (
                <li key={l.id}>
                  <button type="button" disabled={busy} onClick={() => toggle(l.id, member)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg">
                    <span className="truncate">{l.name}</span>{member && <Check size={14} className="text-accent" />}
                  </button>
                </li>
              );
            })}
            {lists?.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No lists yet. Create one below.</li>}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createAndAdd(); }} className="mt-2 flex gap-1.5 border-t border-line pt-2">
            <label htmlFor={`new-list-${candidateId}`} className="sr-only">New list name</label>
            <input id={`new-list-${candidateId}`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="New list"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm" />
            <Button type="submit" disabled={busy || !newName.trim()}>Add</Button>
          </form>
          {error && <p role="alert" className="px-2 pt-2 text-sm text-danger">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
