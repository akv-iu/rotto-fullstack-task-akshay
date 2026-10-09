import { z } from 'zod';
import { VOCAB } from './vocab';

export type Unsupported = { text: string; reason: 'unsupported' | 'unclear' };
export type CompanyType = 'startup' | 'enterprise';

export type Filters = {
  roles?: string[];
  not_roles?: string[]; // none of these roles
  seniorities?: string[];
  cities?: string[];
  skills?: string[]; // must have ALL
  any_skills?: string[]; // must have AT LEAST ONE
  not_skills?: string[]; // must have NONE of them
  companies?: string[]; // any job in the history
  all_companies?: string[]; // worked at EVERY one of them (any jobs)
  current_companies?: string[];
  not_companies?: string[]; // never worked at any of them (any job)
  degrees?: string[];
  fields?: string[];
  schools?: string[];
  min_years?: number;
  max_years?: number;
  open_to_work?: boolean; // true: only people open to work; false: only people who are not
  worked_at_company_type?: CompanyType; // any job in the history
  current_company_type?: CompanyType;
  never_company_type?: CompanyType; // no job of this type, ever
  unsupported?: Unsupported[]; // non-empty → zero results
};

/** Which allowed-value list each list filter is checked against. */
export const LIST_KEYS = {
  roles: 'roles',
  not_roles: 'roles',
  seniorities: 'seniorities',
  cities: 'cities',
  skills: 'skills',
  any_skills: 'skills',
  not_skills: 'skills',
  companies: 'companies',
  all_companies: 'companies',
  current_companies: 'companies',
  not_companies: 'companies',
  degrees: 'degrees',
  fields: 'fields',
  schools: 'schools',
} as const satisfies Record<string, keyof typeof VOCAB>;
export type ListKey = keyof typeof LIST_KEYS;

export const MAX_YEARS = 15;

export const CHIP_LABELS: Record<Exclude<keyof Filters, 'unsupported'>, string> = {
  roles: 'Role',
  not_roles: 'Not a',
  seniorities: 'Seniority',
  cities: 'City',
  skills: 'Skill',
  any_skills: 'Any of',
  not_skills: "Doesn't know",
  companies: 'Worked at',
  all_companies: 'Worked at all of',
  current_companies: 'Currently at',
  not_companies: 'Never worked at',
  degrees: 'Degree',
  fields: 'Studied',
  schools: 'School',
  min_years: 'At least',
  max_years: 'At most',
  open_to_work: 'Open to work',
  worked_at_company_type: 'Worked at a',
  current_company_type: 'Currently at a',
  never_company_type: 'Never worked at a',
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
    if (Object.hasOwn(LIST_KEYS, key)) { // not `in`: that also matches inherited names like "toString"
      const values = list.safeParse(value);
      if (!values.success) { reject(show(key, value)); continue; }
      const allowed = VOCAB[LIST_KEYS[key as ListKey]] as readonly string[];
      const kept = [...new Set(values.data.filter((v) => allowed.includes(v)))];
      for (const v of values.data) if (!allowed.includes(v)) reject(v);
      // Every possible value ("all 10 cities") narrows nothing, so it is dropped: listing everything can't fetch everyone.
      // Not for the "ALL of these" lists or the exclusions ("NONE of these"): those still narrow.
      const narrowsNothing = !['skills', 'all_companies', 'not_skills', 'not_companies', 'not_roles'].includes(key) && kept.length === allowed.length;
      if (kept.length && !narrowsNothing) filters[key as ListKey] = kept;
    } else if (key === 'min_years' || key === 'max_years') {
      const n = years.safeParse(value);
      if (!n.success) { reject(show(key, value)); continue; }
      // Whole years, rounded so the bound never lets in someone outside it ("at least 2.5" -> 3). Not clamped to the
      // data's 0-15: "more than 15 years" (16) must find nobody, not the 15-year people.
      const y = key === 'min_years' ? Math.ceil(n.data) : Math.floor(n.data);
      if (key === 'min_years' ? y > 0 : y < MAX_YEARS) filters[key] = y; // 0+ and 15- years mean "anyone": dropped
    } else if (key === 'open_to_work') {
      if (typeof value !== 'boolean') reject(show(key, value));
      else filters.open_to_work = value;
    } else if (key === 'worked_at_company_type' || key === 'current_company_type' || key === 'never_company_type') {
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
