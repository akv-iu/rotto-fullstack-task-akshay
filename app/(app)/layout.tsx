'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppStateProvider, BottomNav, TopBar } from '@/components/app-shell';
import { Skeleton } from '@/components/ui';
import { supabase } from '@/lib/client/supabase';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => (data.session ? setSignedIn(true) : router.replace('/sign-in')));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (!session) router.replace('/sign-in'); });
    return () => data.subscription.unsubscribe();
  }, [router]);

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
      <main className="mx-auto max-w-[1400px] pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AppStateProvider>
  );
}
