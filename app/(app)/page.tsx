'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlanBanner, useAppState } from '@/components/app-shell';
import { ChipBar } from '@/components/search/ChipBar';
import { ProfilePanel } from '@/components/ProfilePanel';
import { ResultRow } from '@/components/search/ResultRow';
import { ShortlistButton } from '@/components/ShortlistButton';
import { EXAMPLES, ErrorBar, FirstVisit, NoResults, RowSkeletons, SearchingSkeleton } from '@/components/search/states';
import { Button, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/client/api';
import { searchCache } from '@/lib/client/search-cache';
import type { CandidateCard, PageResponse, SearchResponse } from '@/lib/server/search';
import type { Filters } from '@/lib/shared/filters';

type Status = 'idle' | 'searching' | 'refining' | 'done' | 'error';

// The brief that produced a search, kept per tab so a restored search can still be saved. Storage may be blocked: ignore.
const rememberBrief = (id: string, brief: string) => { try { sessionStorage.setItem(`brief:${id}`, brief); } catch {} };
const readBrief = (id: string) => { try { return sessionStorage.getItem(`brief:${id}`) ?? ''; } catch { return ''; } };
// The last search in this tab, so the Search tab brings it back after a visit to Shortlists or Saved searches.
const rememberLast = (id: string | null) => { try { if (id) sessionStorage.setItem('lastSearch', id); else sessionStorage.removeItem('lastSearch'); } catch {} };
const readLast = () => { try { return sessionStorage.getItem('lastSearch'); } catch { return null; } };

/**
 * Types the example briefs into the empty search box one after another (as rotto.com does), so people see what to
 * write. Off when the box has text, when out of searches, and for reduced-motion users. Returns '' when off.
 */
function useTypewriter(phrases: readonly string[], on: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let i = 0, n = 0, deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const phrase = phrases[i % phrases.length];
      n = deleting ? n - 2 : n + 1;
      setText(phrase.slice(0, Math.max(n, 0)));
      let wait = deleting ? 18 : 45;
      if (!deleting && n >= phrase.length) { deleting = true; wait = 1800; }
      else if (deleting && n <= 0) { deleting = false; n = 0; i++; wait = 400; }
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [on, phrases]);
  return text;
}

export default function SearchPage() {
  return <Suspense><SearchView /></Suspense>;
}

function SearchView() {
  const { plan, refreshPlan, openUpgrade } = useAppState();
  const params = useSearchParams();
  const router = useRouter();
  // Coming back from Shortlists or Saved searches: start from the remembered screen, not empty (no flash, no request).
  const [cached] = useState(() => {
    const c = searchCache.get();
    const wanted = params.has('new') ? null : params.get('search') ?? (params.get('saved') ? null : readLast());
    return c && c.result.search_id === wanted ? c : null;
  });
  const [brief, setBrief] = useState(cached?.brief ?? '');
  const [searchedBrief, setSearchedBrief] = useState(cached?.searchedBrief ?? '');
  const [result, setResult] = useState<SearchResponse | null>(cached?.result ?? null);
  const [rows, setRows] = useState<CandidateCard[]>(cached?.rows ?? []);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [status, setStatus] = useState<Status>(cached ? 'done' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // What "Try again" repeats: the last search with the brief it was for, or the last restore that failed.
  const retry = useRef<(() => void) | null>(null);
  const startedFromSaved = useRef(false);
  const restored = useRef<string | null>(cached?.result.search_id ?? null);
  // Each request that replaces the results takes a number; an answer is used only if no newer request started since
  // (a slow page or an old restore must never land on top of newer results). `running` marks a search in flight.
  const latest = useRef(0);
  const running = useRef(false);
  const outOfSearches = plan?.plan === 'free' && plan.searches_remaining === 0;
  // Before the first search the page is a landing page (centred headline + big search box, like rotto.com);
  // once there is a search it becomes the working layout (search bar on top, chips, results).
  const hero = !result && status !== 'searching' && status !== 'refining';
  const typed = useTypewriter(EXAMPLES, hero && !brief && !outOfSearches);
  const savable = Boolean(searchedBrief && result && Object.keys(result.filters).length && !result.filters.unsupported);
  // Typing in the search box re-renders this page; without this, every keystroke also re-rendered every result row
  // (150 ms per key with 300 rows loaded). The list only changes when the rows, the filters or the open profile change.
  const filters = result?.filters;
  const resultRows = useMemo(() => filters && rows.map((c) => (
    <ResultRow key={c.id} candidate={c} filters={filters} selected={openId === c.id} onOpen={() => setOpenId(c.id)}
      action={<ShortlistButton candidateId={c.id} name={c.full_name} compact />} />
  )), [rows, filters, openId]);

  const run = useCallback(async (body: object, kind: 'searching' | 'refining', label: string) => {
    const mine = ++latest.current;
    running.current = true;
    retry.current = () => run(body, kind, label); // keeps the brief this request was for (not whatever is typed now)
    setStatus(kind); setError(null); setSaveState('idle'); setMoreState('idle');
    try {
      const r = await api<SearchResponse>('/api/search', { method: 'POST', body });
      if (mine !== latest.current) return;
      setResult(r); setRows(r.results); setPage(1); setSearchedBrief(label); setStatus('done'); setMoreState('idle');
      // Keep the search in the URL: leaving the page or reloading brings it back, so a free user can still refine it.
      restored.current = r.search_id;
      rememberBrief(r.search_id, label);
      rememberLast(r.search_id);
      router.replace(`/?search=${r.search_id}`, { scroll: false });
    } catch (e) {
      if (mine !== latest.current) return;
      const err = e as ApiError;
      if (err.status === 402) { openUpgrade(); setStatus(result ? 'done' : 'idle'); }
      else { setError(err.message); setStatus('error'); }
    } finally {
      if (mine === latest.current) running.current = false;
      refreshPlan().catch(() => {});
    }
  }, [openUpgrade, refreshPlan, result, router]);

  const restore = useCallback((id: string) => {
    restored.current = id;
    const mine = ++latest.current;
    setStatus('refining'); setError(null);
    api<PageResponse>(`/api/search/${id}?page=1`)
      .then((r) => {
        if (mine !== latest.current) return;
        setResult({ search_id: id, filters: r.filters, total: r.total, results: r.results, searches_remaining: null });
        setRows(r.results); setPage(1); setStatus('done');
        const saved = readBrief(id); setSearchedBrief(saved); setBrief(saved); // show what these results are for
      })
      .catch((e: ApiError) => {
        if (mine !== latest.current) return;
        // Gone or not ours (e.g. another company's search after a sign-in switch): forget it. Anything else is
        // temporary: keep it (a free user may have no other way back to their one search) and offer a retry.
        if (e.status === 404 || e.status === 400) { rememberLast(null); setStatus('idle'); router.replace('/'); return; }
        retry.current = () => restore(id);
        setError("We couldn't load your last search."); setStatus('error');
      });
  }, [router]);

  // Restore /?search=<id> (after navigating away, or a reload). Paging never uses a search.
  // Plain / (the Search tab) brings back this tab's last search; typing a new brief still starts a new one.
  // /?new (the Rotto logo) shows an empty search; the last search stays remembered for the Search tab.
  useEffect(() => {
    if (params.has('new')) {
      latest.current++; running.current = false; restored.current = null;
      setResult(null); setRows([]); setBrief(''); setSearchedBrief(''); setStatus('idle'); setError(null); setOpenId(null); setMoreState('idle');
      return;
    }
    const id = params.get('search');
    if (!id && !params.get('saved')) {
      if (running.current) return; // a search is on its way (e.g. a saved re-run); don't bring back the old one over it
      const last = readLast();
      if (last) router.replace(`/?search=${last}`, { scroll: false }); // already showing it (from memory)? the effect below skips the fetch
      return;
    }
    if (!id || restored.current === id) return;
    restore(id);
  }, [params, router, restore]);

  // Re-run a saved search: /?saved=<id>&brief=<text> (from the Saved searches page). Guarded for React StrictMode.
  useEffect(() => {
    const savedId = params.get('saved');
    if (!savedId || startedFromSaved.current) return;
    startedFromSaved.current = true;
    const savedBrief = params.get('brief') ?? '';
    setBrief(savedBrief);
    router.replace('/');
    run({ saved_brief_id: savedId }, 'searching', savedBrief);
  }, [params, router, run]);

  // Remember the screen as it changes, and the scroll position when leaving; put the scroll back on return.
  const scrollY = useRef(0);
  useEffect(() => {
    if (result) searchCache.set({ result, rows, page, brief, searchedBrief, scrollY: scrollY.current });
  }, [result, rows, page, brief, searchedBrief]);
  useEffect(() => {
    if (cached) requestAnimationFrame(() => window.scrollTo(0, cached.scrollY));
    const onScroll = () => { scrollY.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      const s = searchCache.get();
      if (s) searchCache.set({ ...s, scrollY: scrollY.current });
    };
  }, [cached]);

  const search = () => { const text = brief.trim(); if (text) run({ brief: text }, 'searching', text); };
  const refine = (filters: Filters) => {
    // Picking the value a chip already has changes nothing: no request, and none of the 10 edits used.
    if (!result || JSON.stringify(filters) === JSON.stringify(result.filters)) return;
    run({ parent_search_id: result.search_id, filters }, 'refining', searchedBrief);
  };

  async function loadMore() {
    if (!result) return;
    const mine = latest.current; // a new search or refine since then makes this page belong to old results
    setMoreState('loading');
    try {
      const r = await api<PageResponse>(`/api/search/${result.search_id}?page=${page + 1}`);
      if (mine !== latest.current) return;
      setRows((prev) => [...prev, ...r.results]); setPage(page + 1); setMoreState('idle');
    } catch { if (mine === latest.current) setMoreState('error'); }
  }

  async function save() {
    if (!result || status !== 'done') return; // while results are being replaced, the button would save the old ones
    const mine = latest.current; // a refine since then means the button now belongs to a search that wasn't saved
    setSaveState('saving');
    try {
      await api('/api/saved-briefs', { method: 'POST', body: { brief: searchedBrief, filters: result.filters } });
      if (mine === latest.current) setSaveState('saved');
    } catch { if (mine === latest.current) setSaveState('error'); }
  }

  return (
    <div className="flex items-start">
      <section className={cx('min-w-0 flex-1 px-4 py-5 md:px-6', hero && 'relative isolate overflow-x-clip pb-16')}>
        {hero && (
          <div aria-hidden className="hero-backdrop">
            <div className="hero-dots" />{[0, 1, 2, 3, 4].map((i) => <div key={i} className="hero-ring" />)}<div className="hero-halo" />
          </div>
        )}
        <PlanBanner />
        {hero && (
          <div className="mx-auto max-w-3xl pt-8 text-center md:pt-20">
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">Find the right people,<br className="hidden sm:block" /> in plain English.</h1>
            <p className="mx-auto mt-4 max-w-xl text-muted md:text-lg">Describe who you want. We turn it into filters you can see and change, then search 5,000 candidates.</p>
          </div>
        )}
        <div className={cx('relative isolate', hero && 'mx-auto mt-8 max-w-2xl md:mt-10')}>
        <div aria-hidden className={cx('search-glow', hero && 'is-hero')} />
        <form onSubmit={(e) => { e.preventDefault(); search(); }}
          className={cx('flex items-center gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3 shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--accent)_35%,transparent)] focus-within:border-accent',
            hero && 'rounded-2xl p-2 pl-4 md:text-lg')}>
          <label htmlFor="brief" className="sr-only">Describe who you&apos;re looking for</label>
          <input id="brief" value={brief} maxLength={500} onChange={(e) => setBrief(e.target.value)} disabled={outOfSearches}
            aria-describedby={outOfSearches ? 'brief-help' : undefined} placeholder={typed ? `${typed}|` : "Describe who you're looking for…"}
            className={cx('min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted', hero && 'py-3')} />
          <Button type="submit" variant="primary" disabled={outOfSearches || status === 'searching' || !brief.trim()}>
            {status === 'searching' ? 'Searching…' : 'Search'}
          </Button>
        </form>
        </div>
        {outOfSearches && <p id="brief-help" className={cx("mt-1.5 text-sm text-muted", hero && "text-center")}>New searches need the paid plan. You can still change the filters of your last search.</p>}

        {status === 'idle' && !result && <FirstVisit onPick={setBrief} freeLeft={plan?.plan === 'free' ? plan.searches_remaining : null} />}
        {status === 'searching' && <SearchingSkeleton />}
        {status === 'refining' && !result && <RowSkeletons />}
        {status === 'error' && error && (
          <ErrorBar message={error} onRetry={retry.current ?? undefined} />
        )}

        {result && status !== 'searching' && (
          <div className="mt-4 space-y-3">
            <ChipBar filters={result.filters} onChange={refine} disabled={status === 'refining'} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted" aria-live="polite">
                {status === 'refining' ? 'Updating…' : `${result.total} ${result.total === 1 ? 'person matches' : 'people match'} all filters`}
              </span>
              {/* Only a search that can return people is worth saving: a re-run uses a search (FR-7.2). */}
              <Button onClick={save} disabled={!savable || status !== 'done' || saveState === 'saving' || saveState === 'saved'}>
                {saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Try saving again' : 'Save search'}
              </Button>
            </div>
            {status === 'refining' ? <RowSkeletons /> : rows.length > 0 ? (
              <>
                <ul className="-mx-4 overflow-hidden border-b border-line md:mx-0 md:rounded-xl md:border">
                  {resultRows}
                </ul>
                {moreState === 'loading' && <RowSkeletons rows={3} />}
                {rows.length < result.total && (
                  <Button onClick={loadMore} disabled={moreState === 'loading'} className="w-full">
                    {moreState === 'loading' ? 'Loading…' : moreState === 'error' ? 'Try again' : `Show more (${rows.length} of ${result.total})`}
                  </Button>
                )}
              </>
            ) : <NoResults filters={result.filters} onClear={() => refine({})} />}
          </div>
        )}
      </section>
      {openId && result && (
        <ProfilePanel id={openId} onClose={() => setOpenId(null)}
          highlight={new Set([...(result.filters.skills ?? []), ...(result.filters.any_skills ?? [])])} />
      )}
    </div>
  );
}
