'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { BookmarkSimple, ListChecks, MagnifyingGlass, SignOut } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { supabase } from '@/lib/client/supabase';
import { ErrorBar } from './search/states';
import { ThemeToggle } from './ThemeToggle';
import { Button, Skeleton, cx } from './ui';

export type Plan = { plan: 'free' | 'paid'; searches_remaining: number | null };
export type ShortlistSummary = { id: string; name: string; count: number; candidate_ids: string[] };

type AppState = {
  plan: Plan | null;
  refreshPlan: () => Promise<void>;
  lists: ShortlistSummary[] | null;
  refreshLists: () => Promise<void>;
  openUpgrade: () => void;
  loadFailed: boolean;
  retryLoad: () => void;
};
const AppStateContext = createContext<AppState | null>(null);
export const useAppState = () => useContext(AppStateContext)!;

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [lists, setLists] = useState<ShortlistSummary[] | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const refreshPlan = useCallback(async () => setPlan(await api<Plan>('/api/plan')), []);
  const refreshLists = useCallback(async () => setLists(await api<ShortlistSummary[]>('/api/shortlists')), []);
  // Without the plan and the shortlists the app can only show skeletons, so a failed first load says so and offers a retry.
  const [loadFailed, setLoadFailed] = useState(false);
  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    Promise.all([refreshPlan(), refreshLists()]).catch(() => setLoadFailed(true));
  }, [refreshPlan, refreshLists]);
  useEffect(retryLoad, [retryLoad]);

  // An upgrade lands through the billing webhook, not through this page: re-read the plan when the recruiter comes back
  // to the tab, and every 15 s while a free company is out of searches, so the search box unlocks without a reload.
  const waitingForUpgrade = plan?.plan === 'free' && plan.searches_remaining === 0;
  useEffect(() => {
    const check = () => { refreshPlan().catch(() => {}); };
    window.addEventListener('focus', check);
    const timer = waitingForUpgrade ? setInterval(check, 15_000) : undefined;
    return () => { window.removeEventListener('focus', check); clearInterval(timer); };
  }, [refreshPlan, waitingForUpgrade]);

  const closeUpgrade = (open: boolean) => { setUpgradeOpen(open); if (!open) refreshPlan().catch(() => {}); };
  return (
    <AppStateContext.Provider value={{ plan, refreshPlan, lists, refreshLists, openUpgrade: () => setUpgradeOpen(true), loadFailed, retryLoad }}>
      {children}
      <UpgradeDialog open={upgradeOpen} onOpenChange={closeUpgrade} />
    </AppStateContext.Provider>
  );
}

const LINKS = [
  { href: '/', label: 'Search', Icon: MagnifyingGlass },
  { href: '/shortlists', label: 'Shortlists', Icon: ListChecks },
  { href: '/saved', label: 'Saved searches', Icon: BookmarkSimple },
];
const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 md:px-6">
        <Link href="/?new" className="text-base font-semibold tracking-tight">Rotto</Link>
        <nav aria-label="Main" className="hidden gap-5 text-sm md:flex">
          {LINKS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={isActive(pathname, href) ? 'font-medium text-ink' : 'text-muted hover:text-ink'}>{label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <PlanStatus />
          <ThemeToggle />
          <Button variant="quiet" aria-label="Sign out" onClick={() => supabase.auth.signOut()} className="min-w-11 px-1"><SignOut size={18} /></Button>
        </div>
      </div>
    </header>
  );
}

function PlanStatus() {
  const { plan, openUpgrade } = useAppState();
  if (!plan) return <Skeleton className="h-5 w-40" />;
  if (plan.plan === 'paid') return <span className="text-sm text-muted">Paid plan</span>;
  const n = plan.searches_remaining ?? 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="whitespace-nowrap text-muted"><span className="hidden sm:inline">Free plan · </span>{n} {n === 1 ? 'search' : 'searches'} left</span>
      <Button variant="accent" onClick={openUpgrade}>Upgrade</Button>
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {LINKS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
          className={cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs', isActive(pathname, href) ? 'font-medium text-ink' : 'text-muted')}>
          <Icon size={20} weight={isActive(pathname, href) ? 'fill' : 'regular'} />
          {label === 'Saved searches' ? 'Saved' : label}
        </Link>
      ))}
    </nav>
  );
}

export function LoadErrorBar() {
  const { loadFailed, retryLoad } = useAppState();
  if (!loadFailed) return null;
  return <div className="mx-auto max-w-[1400px] px-4 md:px-6"><ErrorBar message="We couldn't load your plan and shortlists." onRetry={retryLoad} /></div>;
}

export function PlanBanner() {
  const { plan, openUpgrade } = useAppState();
  if (plan?.plan !== 'free' || plan.searches_remaining !== 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-accent-line bg-accent-soft p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-medium">You&apos;ve used your free search.</p>
        <p className="text-sm text-muted">You can still refine its filters, open candidates, and shortlist. Upgrade to run new searches.</p>
      </div>
      <Button variant="primary" onClick={openUpgrade}>Upgrade</Button>
    </div>
  );
}

function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold">Upgrade to the paid plan</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Unlimited searches for everyone at your company.</Dialog.Description>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            <li>Your admin subscribes through Stripe.</li>
            <li>Stripe confirms the payment with us.</li>
            <li>Your plan switches to paid automatically, usually within seconds.</li>
          </ol>
          <Dialog.Close asChild><Button variant="primary" className="mt-6">Got it</Button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
