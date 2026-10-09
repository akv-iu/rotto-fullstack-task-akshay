import { CHIP_LABELS, LIST_KEYS, type Filters, type ListKey } from '@/lib/shared/filters';
import { VOCAB } from '@/lib/shared/vocab';

export type ScalarKey = 'min_years' | 'max_years' | 'open_to_work' | 'worked_at_company_type' | 'current_company_type' | 'never_company_type';
export type Chip =
  | { kind: 'list'; key: ListKey; value: string; label: string; text: string }
  | { kind: 'group'; key: 'roles'; values: readonly string[]; label: string; text: string }
  | { kind: 'scalar'; key: ScalarKey; label: string; text: string }
  | { kind: 'unsupported'; index: number; text: string; reason: 'unsupported' | 'unclear' };

// Display order: who, where, what they know, where they worked, education.
const ORDER: ListKey[] = ['roles', 'seniorities', 'cities', 'skills', 'any_skills', 'not_skills', 'companies', 'current_companies', 'not_companies', 'degrees', 'fields', 'schools'];

/** Every engineering role. "engineers in Texas" sets all of them; one chip reads better than seven. */
export const ENGINEERING_ROLES: readonly string[] = VOCAB.roles.filter((r) => r.endsWith('Engineer'));

export const optionsFor = (key: ListKey): readonly string[] => VOCAB[LIST_KEYS[key]];
export const display = (key: ListKey, value: string) => (key === 'seniorities' ? value[0].toUpperCase() + value.slice(1) : value);

export function chipsOf(f: Filters): Chip[] {
  const chips: Chip[] = [];
  for (const key of ORDER) {
    let values = f[key] ?? [];
    if (key === 'roles' && ENGINEERING_ROLES.every((r) => values.includes(r))) {
      chips.push({ kind: 'group', key: 'roles', values: ENGINEERING_ROLES, label: CHIP_LABELS.roles, text: 'Any engineer' });
      values = values.filter((v) => !ENGINEERING_ROLES.includes(v));
    }
    for (const value of values) chips.push({ kind: 'list', key, value, label: CHIP_LABELS[key], text: display(key, value) });
  }
  if (f.min_years != null) chips.push({ kind: 'scalar', key: 'min_years', label: CHIP_LABELS.min_years, text: `${f.min_years} yrs` });
  if (f.max_years != null) chips.push({ kind: 'scalar', key: 'max_years', label: CHIP_LABELS.max_years, text: `${f.max_years} yrs` });
  if (f.open_to_work != null) chips.push({ kind: 'scalar', key: 'open_to_work', label: '', text: f.open_to_work ? 'Open to work' : 'Not open to work' });
  if (f.worked_at_company_type) chips.push({ kind: 'scalar', key: 'worked_at_company_type', label: CHIP_LABELS.worked_at_company_type, text: f.worked_at_company_type });
  if (f.current_company_type) chips.push({ kind: 'scalar', key: 'current_company_type', label: CHIP_LABELS.current_company_type, text: f.current_company_type });
  if (f.never_company_type) chips.push({ kind: 'scalar', key: 'never_company_type', label: CHIP_LABELS.never_company_type, text: f.never_company_type });
  (f.unsupported ?? []).forEach((u, index) => chips.push({ kind: 'unsupported', index, text: u.text, reason: u.reason }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  const next: Filters = structuredClone(f);
  if (chip.kind === 'list' || chip.kind === 'group') {
    const drop = chip.kind === 'list' ? [chip.value] : chip.values;
    const rest = (next[chip.key] ?? []).filter((v) => !drop.includes(v));
    if (rest.length) next[chip.key] = rest; else delete next[chip.key];
  } else if (chip.kind === 'scalar') {
    delete next[chip.key];
  } else {
    const rest = (next.unsupported ?? []).filter((_, i) => i !== chip.index);
    if (rest.length) next.unsupported = rest; else delete next.unsupported;
  }
  return next;
}

export function replaceValue(f: Filters, key: ListKey, oldValue: string | null, newValue: string): Filters {
  const next: Filters = structuredClone(f);
  const current = next[key] ?? [];
  const at = oldValue === null ? -1 : current.indexOf(oldValue);
  const updated = at >= 0 ? current.map((v, i) => (i === at ? newValue : v)) : [...current, newValue];
  next[key] = [...new Set(updated)];
  return next;
}

export function setScalar<K extends ScalarKey>(f: Filters, key: K, value: Filters[K]): Filters {
  const next: Filters = structuredClone(f);
  next[key] = value;
  return next;
}

/** Picking one role on the "Any engineer" chip replaces the whole group with that role. */
export function replaceGroup(f: Filters, role: string): Filters {
  const next: Filters = structuredClone(f);
  next.roles = [...new Set([...(next.roles ?? []).filter((r) => !ENGINEERING_ROLES.includes(r)), role])];
  return next;
}
