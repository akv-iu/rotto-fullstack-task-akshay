'use client';
import { Moon, Sun } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from './ui';

const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

/** Light/dark switch. Until pressed, the app follows the device setting; the choice is remembered in this browser. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null); // unknown until mounted (the server can't know)
  useEffect(() => {
    setDark(isDark());
    // Follow the device if its setting changes while the page is open (matters until the toggle is used).
    const m = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(isDark());
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
  function toggle() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    setDark(next === 'dark');
  }
  return (
    <Button variant="quiet" onClick={toggle} className="min-w-11 px-1"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark === null ? <span className="size-[18px]" /> : dark ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  );
}
