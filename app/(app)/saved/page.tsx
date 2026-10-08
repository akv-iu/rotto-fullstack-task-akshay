'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { chipsOf } from '@/components/search/chip-model';
import { ErrorBar } from '@/components/search/states';
import { Button, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { Filters } from '@/lib/shared/filters';

type Saved = { id: string; brief: string; filters: Filters; created_at: string };

export default function SavedPage() {
  const router = useRouter();
  const { plan, openUpgrade } = useAppState();
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Saved | null>(null);
  const out = plan?.plan === 'free' && plan.searches_remaining === 0;

  const load = () => api<Saved[]>('/api/saved-briefs').then(setSaved).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <section className="px-4 py-5 md:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Saved searches</h1>
      <p className="mt-1 text-sm text-muted">Running a saved search uses a search on the free plan.</p>
      {error && <ErrorBar message={error} />}
      {saved === null && !error && <div className="mt-6 space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
      {saved?.length === 0 && (
        <EmptyState title="No saved searches yet." body="Run a search, then press Save search next to the results.">
          <Link href="/" className={buttonClass('primary')}>Go to search</Link>
        </EmptyState>
      )}
      {saved && saved.length > 0 && (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          {saved.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 border-t border-line px-4 py-3 first:border-t-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.brief}</p>
                <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                  {chipsOf(s.filters).map((c, i) => <span key={i} className="rounded bg-line px-1.5">{c.kind === 'unsupported' ? c.text : `${c.label} ${c.text}`.trim()}</span>)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => (out ? openUpgrade() : router.push(`/?saved=${s.id}&brief=${encodeURIComponent(s.brief)}`))}>Run</Button>
                <Button variant="quiet" onClick={() => setDeleting(s)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this saved search?" body={deleting?.brief ?? ''}
        confirmLabel="Delete" onConfirm={() => { const d = deleting!; setDeleting(null); api(`/api/saved-briefs/${d.id}`, { method: 'DELETE' }).then(load).catch((e) => setError(e.message)); }} />
    </section>
  );
}
