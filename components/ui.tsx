import type { ComponentProps } from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-ink hover:bg-bg',
  quiet: 'text-muted hover:text-ink',
  accent: 'border border-accent bg-surface text-accent hover:bg-accent-soft', // Upgrade: one variant, not overrides (they lost to secondary's colours)
} as const;

// 44 px tall on phones (SCORING: tap targets >= 44 px), 36 px from md up.
export const buttonClass = (variant: keyof typeof VARIANTS = 'secondary', className?: string) => cx(
  'inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  VARIANTS[variant],
  className,
);

// ComponentProps<'button'> includes `ref` in React 19, so callers can pass one without forwardRef.
export function Button({ variant = 'secondary', className, ...props }: ComponentProps<'button'> & { variant?: keyof typeof VARIANTS }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('skeleton block', className)} />;
}
