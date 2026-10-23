'use client';
import * as Popover from '@radix-ui/react-popover';
import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { CHIP_LABELS, type Filters, type ListKey } from '@/lib/shared/filters';
import { Button, cx } from '@/components/ui';
import { chipsOf, display, optionsFor, removeChip, replaceGroup, replaceValue, setScalar, type Chip } from './chip-model';

type Props = { filters: Filters; onChange: (filters: Filters) => void; disabled?: boolean };

const POPOVER = 'z-30 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl';
const CHIP = 'inline-flex min-w-0 max-w-full items-center rounded-full border text-sm [overflow-wrap:anywhere]';

export function ChipBar({ filters, onChange, disabled }: Props) {
  const chips = chipsOf(filters);
  return (
    <div role="group" aria-label="Filters the search understood"
      className="flex flex-wrap items-center gap-2 pb-1">
      {chips.map((chip) => (
        <ChipView key={chip.kind === 'unsupported' ? `u${chip.index}` : `${chip.key}:${chip.kind === 'list' ? chip.value : ''}`}
          chip={chip} filters={filters} onChange={onChange} disabled={disabled} />
      ))}
      <AddFilter filters={filters} onChange={onChange} disabled={disabled} />
      {chips.length > 0 && (
        <button type="button" disabled={disabled} onClick={() => onChange({})}
          className="min-h-11 shrink-0 text-sm text-muted underline underline-offset-2 hover:text-ink md:min-h-0">Clear filters</button>
      )}
    </div>
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={`Remove ${label}`} title={`Remove ${label}`} disabled={disabled} onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink md:size-7"><X size={12} weight="bold" /></button>
  );
}

function ChipView({ chip, filters, onChange, disabled }: { chip: Chip } & Props) {
  const [open, setOpen] = useState(false);
  if (chip.kind === 'unsupported') {
    const note = chip.reason === 'unclear' ? 'unclear, pick a filter' : 'not in our data';
    return (
      <span className={cx(CHIP, 'border-warn-line bg-warn-soft pl-3 text-warn')}>
        {chip.text} · {note}
        <RemoveButton label={chip.text} disabled={disabled} onClick={() => onChange(removeChip(filters, chip))} />
      </span>
    );
  }
  const name = `${chip.label} ${chip.text}`.trim();
  return (
    <span className={cx(CHIP, 'border-border bg-surface pl-3', open && 'border-accent ring-2 ring-accent/20')}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild disabled={disabled}>
          <button type="button" className="min-h-11 min-w-0 py-1 text-left md:min-h-0" aria-label={`Change ${name}`}>
            {chip.label && <span className="text-muted">{chip.label} </span>}{chip.text}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} align="start" className={POPOVER}>
            {chip.kind === 'group' ? (
              <OptionPicker listKey={chip.key} onPick={(v) => { setOpen(false); onChange(replaceGroup(filters, v, chip.key)); }} />
            ) : chip.kind === 'list' ? (
              <OptionPicker listKey={chip.key} selected={chip.value}
                onPick={(v) => { setOpen(false); onChange(replaceValue(filters, chip.key, chip.value, v)); }} />
            ) : chip.key === 'min_years' || chip.key === 'max_years' ? (
              <YearsPicker initial={filters[chip.key] ?? 0} onPick={(n) => { setOpen(false); onChange(setScalar(filters, chip.key as 'min_years', n)); }} />
            ) : chip.key === 'open_to_work' ? (
              <ChoicePicker choices={[[true, 'Open to work'], [false, 'Not open to work']]} current={filters.open_to_work}
                onPick={(v) => { setOpen(false); onChange(setScalar(filters, 'open_to_work', v)); }} />
            ) : (
              <ChoicePicker choices={COMPANY_TYPES} current={filters[chip.key as 'worked_at_company_type']}
                onPick={(t) => { setOpen(false); onChange(setScalar(filters, chip.key as 'worked_at_company_type', t)); }} />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <RemoveButton label={name} disabled={disabled} onClick={() => onChange(removeChip(filters, chip))} />
    </span>
  );
}

function OptionPicker({ listKey, selected, onPick }: { listKey: ListKey; selected?: string; onPick: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const options = optionsFor(listKey).filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div>
      <label className="sr-only" htmlFor={`pick-${listKey}`}>Search {CHIP_LABELS[listKey]}</label>
      <input id={`pick-${listKey}`} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
        className="mb-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm" />
      <ul className="max-h-64 overflow-y-auto">
        {options.map((o) => (
          <li key={o}>
            <button type="button" onClick={() => onPick(o)}
              className={cx('flex min-h-11 w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg md:min-h-0', o === selected && 'bg-accent-soft font-medium text-accent')}>
              {display(listKey, o)}{o === selected && <span aria-hidden>✓</span>}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="px-2.5 py-1.5 text-sm text-muted">Not in our data</li>}
      </ul>
    </div>
  );
}

function YearsPicker({ initial, onPick }: { initial: number; onPick: (n: number) => void }) {
  const [n, setN] = useState(initial);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onPick(n); }} className="flex items-end gap-2 p-1">
      <label className="flex-1 text-sm">Years
        <input type="number" min={0} max={15} value={n} onChange={(e) => setN(Math.max(0, Math.min(15, Number(e.target.value))))}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5" />
      </label>
      <Button type="submit" variant="primary">Apply</Button>
    </form>
  );
}

const COMPANY_TYPES: ['startup' | 'enterprise', string][] = [['startup', 'startup'], ['enterprise', 'enterprise']];

/** A two-way choice (open to work, startup or enterprise) that ticks the current value, like the option lists. */
function ChoicePicker<T extends string | boolean>({ choices, current, onPick }: { choices: [T, string][]; current: T | undefined; onPick: (v: T) => void }) {
  return (
    <div className="grid gap-1">
      {choices.map(([v, label]) => (
        <button key={label} type="button" onClick={() => onPick(v)} aria-current={v === current || undefined}
          className={cx('flex min-h-11 w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg md:min-h-0', v === current && 'bg-accent-soft font-medium text-accent')}>
          {label}{v === current && <span aria-hidden>✓</span>}
        </button>
      ))}
    </div>
  );
}

const ADDABLE: { key: ListKey | 'min_years' | 'open_to_work' | 'worked_at_company_type'; label: string }[] = [
  { key: 'roles', label: 'Role' }, { key: 'seniorities', label: 'Seniority' }, { key: 'cities', label: 'City' },
  { key: 'skills', label: 'Skill' }, { key: 'min_years', label: 'Minimum years' }, { key: 'open_to_work', label: 'Open to work' },
  { key: 'worked_at_company_type', label: 'Worked at a startup or enterprise' }, { key: 'companies', label: 'Worked at company' },
  { key: 'degrees', label: 'Degree' }, { key: 'fields', label: 'Field of study' }, { key: 'schools', label: 'School' },
];

function AddFilter({ filters, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<(typeof ADDABLE)[number]['key'] | null>(null);
  const close = (next: Filters) => { setOpen(false); setStep(null); onChange(next); };
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setStep(null); }}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" className={cx(CHIP, 'min-h-11 border-dashed border-border px-3 py-1 text-muted hover:text-ink md:min-h-0')}>
          <Plus size={12} weight="bold" className="mr-1" />Filter
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" className={POPOVER}>
          {step === null && (
            <ul>
              {ADDABLE.map((a) => (
                <li key={a.key}>
                  <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg"
                    onClick={() => (a.key === 'open_to_work' ? close(setScalar(filters, 'open_to_work', true)) : setStep(a.key))}>{a.label}</button>
                </li>
              ))}
            </ul>
          )}
          {step === 'min_years' && <YearsPicker initial={5} onPick={(n) => close(setScalar(filters, 'min_years', n))} />}
          {step === 'worked_at_company_type' && <ChoicePicker choices={COMPANY_TYPES} current={filters.worked_at_company_type} onPick={(t) => close(setScalar(filters, 'worked_at_company_type', t))} />}
          {step && step !== 'min_years' && step !== 'worked_at_company_type' && step !== 'open_to_work' && (
            <OptionPicker listKey={step} onPick={(v) => close(replaceValue(filters, step, null, v))} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
