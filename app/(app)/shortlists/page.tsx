'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';

export default function ShortlistsPage() {
  const { lists, refreshLists } = useAppState();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await refreshLists(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="px-4 py-5 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Shortlists</h1>
      <form onSubmit={(e) => { e.preventDefault(); act(async () => { await api('/api/shortlists', { method: 'POST', body: { name } }); setName(''); }); }}
        className="mt-4 flex max-w-md gap-2">
        <label htmlFor="new-list" className="sr-only">New list name</label>
        <input id="new-list" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New list name"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2" />
        <Button type="submit" variant="primary" disabled={!name.trim()}>New list</Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {lists === null && <div className="mt-6 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {lists?.length === 0 && (
        <EmptyState title="No shortlists yet." body="Shortlist someone from search results, or create an empty list to fill later.">
          <Link href="/" className={buttonClass('primary')}>Go to search</Link>
        </EmptyState>
      )}
      {lists && lists.length > 0 && (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          {lists.map((l) => (
            <li key={l.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
              {editing?.id === l.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); act(async () => { await api(`/api/shortlists/${l.id}`, { method: 'PATCH', body: { name: editing.name } }); setEditing(null); }); }}>
                  <label htmlFor={`rename-${l.id}`} className="sr-only">List name</label>
                  <input id={`rename-${l.id}`} autoFocus value={editing.name} maxLength={80} onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1" />
                  <Button type="submit" variant="primary">Save</Button>
                  <Button type="button" variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <Link href={`/shortlists/${l.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="text-sm text-muted">{l.count} {l.count === 1 ? 'person' : 'people'}</span>
                  </Link>
                  <Button variant="quiet" onClick={() => setEditing({ id: l.id, name: l.name })}>Rename</Button>
                  <Button variant="quiet" onClick={() => setDeleting({ id: l.id, name: l.name })}>Delete</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`} body="The list and its members are removed for everyone at your company." confirmLabel="Delete"
        onConfirm={() => { const d = deleting!; setDeleting(null); act(() => api(`/api/shortlists/${d.id}`, { method: 'DELETE' })); }} />
    </section>
  );
}
