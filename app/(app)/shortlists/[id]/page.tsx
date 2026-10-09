'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/components/app-shell';
import { EmptyState } from '@/components/EmptyState';
import { ProfilePanel } from '@/components/ProfilePanel';
import { ResultRow } from '@/components/search/ResultRow';
import { ErrorBar, RowSkeletons } from '@/components/search/states';
import { Button, buttonClass } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { CandidateCard } from '@/lib/server/search';

export default function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { refreshLists } = useAppState();
  const [list, setList] = useState<{ id: string; name: string; people: CandidateCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => api<{ id: string; name: string; people: CandidateCard[] }>(`/api/shortlists/${id}`).then((l) => { setError(null); setList(l); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function remove(personId: string) {
    try { await api(`/api/shortlists/${id}/people/${personId}`, { method: 'DELETE' }); await Promise.all([load(), refreshLists()]); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="flex items-start">
      <section className="min-w-0 flex-1 px-4 py-5 md:px-6">
        <Link href="/shortlists" className="text-sm text-muted hover:text-ink">Shortlists</Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{list?.name ?? ' '}</h1>
        {error && <ErrorBar message={error} onRetry={load} />}
        {!list && !error && <RowSkeletons rows={4} />}
        {list?.people.length === 0 && (
          <EmptyState title="Nobody on this list yet." body="Shortlist people from search results.">
            <Link href="/" className={buttonClass('primary')}>Go to search</Link>
          </EmptyState>
        )}
        {list && list.people.length > 0 && (
          <ul className="mt-4 overflow-hidden border-y border-line md:rounded-xl md:border">
            {list.people.map((c) => (
              <ResultRow key={c.id} candidate={c} filters={{}} selected={openId === c.id} onOpen={() => setOpenId(c.id)}
                action={<Button onClick={() => remove(c.id)} aria-label={`Remove ${c.full_name} from this list`}>Remove</Button>} />
            ))}
          </ul>
        )}
      </section>
      {openId && <ProfilePanel id={openId} highlight={new Set()} onClose={() => setOpenId(null)} />}
    </div>
  );
}
