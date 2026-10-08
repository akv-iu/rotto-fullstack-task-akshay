import { z } from 'zod';
import { VOCAB } from './vocab';

export type Unsupported = { text: string; reason: 'unsupported' | 'unclear' };
export type CompanyType = 'startup' | 'enterprise';

export type Filters = {
  roles?: string[];
  seniorities?: string[];
  cities?: string[];
  skills?: string[]; // must have ALL
  any_skills?: string[]; // must have AT LEAST ONE
  companies?: string[]; // any job in the history
  current_companies?: string[];
  degrees?: string[];
  fields?: string[];
  schools?: string[];
  min_years?: number;
  max_years?: number;
  open_to_work?: true;
  worked_at_company_type?: CompanyType; // any job in the history
  current_company_type?: CompanyType;
  unsupported?: Unsupported[]; // non-empty → zero results
};

/** Which allowed-value list each list filter is checked against. */
export const LIST_KEYS = {
  roles: 'roles',
  seniorities: 'seniorities',
  cities: 'cities',
  skills: 'skills',
  any_skills: 'skills',
  companies: 'companies',
  current_companies: 'companies',
  degrees: 'degrees',
  fields: 'fields',
  schools: 'schools',
} as const satisfies Record<string, keyof typeof VOCAB>;
export type ListKey = keyof typeof LIST_KEYS;

export const MAX_YEARS = 15;

export const CHIP_LABELS: Record<Exclude<keyof Filters, 'unsupported'>, string> = {
  roles: 'Role',
  seniorities: 'Seniority',
  cities: 'City',
  skills: 'Skill',
  any_skills: 'Any of',
  companies: 'Worked at',
  current_companies: 'Currently at',
  degrees: 'Degree',
  fields: 'Studied',
  schools: 'School',
  min_years: 'At least',
  max_years: 'At most',
  open_to_work: 'Open to work',
  worked_at_company_type: 'Worked at a',
  current_company_type: 'Currently at a',
};

const MAX_TEXT = 120;
const MAX_UNSUPPORTED = 20;
const list = z.array(z.string());
const years = z.number().finite();
const companyType = z.enum(['startup', 'enterprise']);
const unsupportedList = z.array(z.union([z.string(), z.object({ text: z.string(), reason: z.string().optional() })]));

const show = (key: string, value: unknown) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`;

/**
 * The single gate every filter object passes through, whether it came from the AI, the browser or the database.
 * Returns null only for a non-object. Anything it cannot use becomes an `unsupported` chip (never applied, never dropped
 * silently), so odd model output gives "nobody" with a reason instead of a failed search. Never returns "everyone" as runnable.
 */
export function cleanFilters(input: unknown): { filters: Filters; runnable: boolean } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const filters: Filters = {};
  const unsupported: Unsupported[] = [];
  const reject = (text: string, reason: Unsupported['reason'] = 'unsupported') => {
    const t = text.trim().slice(0, MAX_TEXT);
    if (t && !unsupported.some((u) => u.text === t)) unsupported.push({ text: t, reason });
  };

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (key in LIST_KEYS) {
      const values = list.safeParse(value);
      if (!values.success) { reject(show(key, value)); continue; }
      const allowed = VOCAB[LIST_KEYS[key as ListKey]] as readonly string[];
      const kept = [...new Set(values.data.filter((v) => allowed.includes(v)))];
      for (const v of values.data) if (!allowed.includes(v)) reject(v);
      if (kept.length) filters[key as ListKey] = kept;
    } else if (key === 'min_years' || key === 'max_years') {
      const n = years.safeParse(value);
      if (!n.success) { reject(show(key, value)); continue; }
      const y = Math.min(Math.max(Math.round(n.data), 0), MAX_YEARS);
      if (key === 'min_years' ? y > 0 : y < MAX_YEARS) filters[key] = y; // 0+ and 15- years mean "anyone": dropped
    } else if (key === 'open_to_work') {
      if (typeof value !== 'boolean') reject(show(key, value));
      else if (value) filters.open_to_work = true;
    } else if (key === 'worked_at_company_type' || key === 'current_company_type') {
      const t = companyType.safeParse(value);
      if (t.success) filters[key] = t.data;
      else reject(show(key, value));
    } else if (key === 'unsupported') {
      const items = unsupportedList.safeParse(value);
      if (!items.success) { reject(show(key, value)); continue; }
      for (const u of items.data) {
        if (typeof u === 'string') reject(u);
        else reject(u.text, u.reason === 'unclear' ? 'unclear' : 'unsupported');
      }
    } else {
      reject(show(key, value)); // unknown key
    }
  }
  if (unsupported.length) filters.unsupported = unsupported.slice(0, MAX_UNSUPPORTED);

  const hasCondition = Object.keys(filters).some((k) => k !== 'unsupported');
  return { filters, runnable: hasCondition && unsupported.length === 0 };
}
