'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppStateProvider, BottomNav, LoadErrorBar, TopBar } from '@/components/app-shell';
import { Skeleton } from '@/components/ui';
import { searchCache } from '@/lib/client/search-cache';
import { supabase } from '@/lib/client/supabase';
import { startDemoSession } from '@/lib/client/demo-session';
import { ErrorBar } from '@/components/search/states';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      const session = data.session ?? (process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? await startDemoSession() : null);
      if (active) session ? setSignedIn(true) : router.replace('/sign-in');
    }).catch(() => { if (active) setError("We couldn't start your session. Please try again."); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event !== 'SIGNED_OUT') return;
      searchCache.clear(); // never show the last company's search to the next one
      setSignedIn(false);
      if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') setAttempt((n) => n + 1);
      else router.replace('/sign-in');
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [router, attempt]);

  if (error) return <main className="mx-auto max-w-xl p-6"><ErrorBar message={error} onRetry={() => setAttempt((n) => n + 1)} /></main>;

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <AppStateProvider>
      <TopBar />
      <LoadErrorBar />
      <main className="mx-auto max-w-[1400px] pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AppStateProvider>
  );
}
