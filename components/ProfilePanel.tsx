'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/client/api';
import { ShortlistButton } from './ShortlistButton';
import { Avatar, Button, Skeleton, cx } from './ui';

export type Person = {
  id: string; full_name: string; avatar_url: string; headline: string; current_title: string;
  location: { city: string; state: string }; years_experience: number; open_to_work: boolean; skills: string[];
  experiences: { title: string; company: string; company_logo_url: string; company_type: string; start_year: number; end_year: number | null }[];
  education: { school: string; degree: string; field: string; graduation_year: number }[];
};

const PHONE = '(max-width: 767px)';
const usePhone = () => useSyncExternalStore(
  (onChange) => { const m = matchMedia(PHONE); m.addEventListener('change', onChange); return () => m.removeEventListener('change', onChange); },
  () => matchMedia(PHONE).matches,
  () => false,
);

/**
 * Desktop: docked beside the list, which stays usable (focus is not moved, Esc closes).
 * Phone: a full-screen modal dialog (Radix traps focus, closes on Esc, returns focus to the row) (DESIGN §4.1, §7).
 */
export function ProfilePanel({ id, highlight, onClose }: { id: string; highlight: Set<string>; onClose: () => void }) {
  const phone = usePhone();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPerson(null); setError(null);
    api<Person>(`/api/people/${id}`).then((p) => live && setPerson(p)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (phone) return; // Radix handles Esc on the phone dialog
    // defaultPrevented: Esc that only closed a popover inside the panel (Radix prevents it) must not close the panel too.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phone]);

  const body = (
    <>
      <div className="flex items-start justify-between">
        {person ? <Avatar src={person.avatar_url} name={person.full_name} className="size-14 text-base" /> : <Skeleton className="size-14 rounded-full" />}
        <Button variant="quiet" aria-label="Close profile" onClick={onClose} className="min-w-11 px-1"><X size={20} /></Button>
      </div>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {!person && !error && <div className="mt-4 space-y-3" aria-busy="true"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-60" /><Skeleton className="h-24 w-full" /></div>}
      {person && (
        <>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">{person.full_name}</h2>
          <p className="text-muted">{person.current_title} · {person.location.city}, {person.years_experience} years</p>
          {person.open_to_work && <p className="mt-1 text-sm text-accent">Open to work</p>}
          <div className="mt-4"><ShortlistButton candidateId={person.id} name={person.full_name} block /></div>

          <h3 className="mt-6 text-sm font-medium text-muted">Experience</h3>
          {person.experiences.length === 0 ? <p className="mt-2 text-sm text-muted">No experience listed.</p> : (
            <ul className="mt-2 space-y-3">
              {person.experiences.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <img src={e.company_logo_url} alt="" width={24} height={24} className="mt-0.5 size-6 shrink-0 rounded-md bg-line" />
                  <div>
                    <p>{e.title}</p>
                    <p className="text-sm text-muted">{e.company}, {e.company_type}, {e.start_year} to {e.end_year ?? 'now'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-medium text-muted">Education</h3>
          {person.education.length === 0 ? <p className="mt-2 text-sm text-muted">No education listed.</p> : (
            <ul className="mt-2 space-y-2">
              {person.education.map((e, i) => (
                <li key={i}><p>{e.school}</p><p className="text-sm text-muted">{e.degree} {e.field}, {e.graduation_year}</p></li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-medium text-muted">Skills</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {person.skills.map((s) => (
              <span key={s} className={cx('rounded px-1.5 py-0.5 text-sm', highlight.has(s) ? 'bg-accent-soft font-medium text-accent' : 'bg-line text-muted')}>{s}</span>
            ))}
          </div>
        </>
      )}
    </>
  );

  if (phone) {
    return (
      <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-30 overflow-y-auto bg-surface p-5">
            <Dialog.Title className="sr-only">Candidate profile</Dialog.Title>
            {body}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <aside aria-label="Candidate profile"
      className="sticky top-14 h-[calc(100dvh-3.5rem)] w-[380px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5">
      {body}
    </aside>
  );
}
