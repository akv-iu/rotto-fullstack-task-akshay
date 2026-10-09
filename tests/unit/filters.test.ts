import { describe, expect, it } from 'vitest';
import { cleanFilters } from '@/lib/shared/filters';
import { VOCAB } from '@/lib/shared/vocab';

describe('cleanFilters', () => {
  it('keeps allowed values and reports runnable', () => {
    expect(cleanFilters({ roles: ['Data Scientist'], degrees: ['PhD'] })).toEqual({
      filters: { roles: ['Data Scientist'], degrees: ['PhD'] },
      runnable: true,
    });
  });

  it('moves values that are not in the data to unsupported (never applied)', () => {
    const r = cleanFilters({ roles: ['Data Scientist'], cities: ['London'] })!;
    expect(r.filters.cities).toBeUndefined();
    expect(r.filters.unsupported).toEqual([{ text: 'London', reason: 'unsupported' }]);
    expect(r.runnable).toBe(false);
  });

  it('drops filters that do nothing, so they cannot mean "everyone"', () => {
    expect(cleanFilters({ min_years: 0, max_years: 15, roles: [] })).toEqual({ filters: {}, runnable: false });
    expect(cleanFilters({})).toEqual({ filters: {}, runnable: false });
  });

  it('keeps exclusions: skills they lack, companies and company types they never worked at', () => {
    expect(cleanFilters({ not_skills: ['Java', 'Cobol'], not_companies: ['Saltbox'], never_company_type: 'startup' })).toEqual({
      filters: { not_skills: ['Java'], not_companies: ['Saltbox'], never_company_type: 'startup', unsupported: [{ text: 'Cobol', reason: 'unsupported' }] },
      runnable: false,
    });
    expect(cleanFilters({ not_skills: [...VOCAB.skills] })!.filters.not_skills).toHaveLength(VOCAB.skills.length); // still narrows
    expect(cleanFilters({ never_company_type: 'big' })!.runnable).toBe(false);
  });

  it('keeps open_to_work false as a real filter ("not open to work")', () => {
    expect(cleanFilters({ roles: ['Recruiter'], open_to_work: false })).toEqual({ filters: { roles: ['Recruiter'], open_to_work: false }, runnable: true });
    expect(cleanFilters({ open_to_work: true })).toEqual({ filters: { open_to_work: true }, runnable: true });
  });

  it('keeps unclear words and makes the search non-runnable', () => {
    const r = cleanFilters({ roles: ['Product Designer'], unsupported: [{ text: 'experienced', reason: 'unclear' }] })!;
    expect(r.runnable).toBe(false);
    expect(r.filters.unsupported).toEqual([{ text: 'experienced', reason: 'unclear' }]);
  });

  it('dedupes values and drops nulls', () => {
    expect(cleanFilters({ skills: ['Go', 'Go', 'Kubernetes'], cities: null })).toEqual({
      filters: { skills: ['Go', 'Kubernetes'] },
      runnable: true,
    });
  });

  it('returns null only when the input is not an object', () => {
    expect(cleanFilters(null)).toBeNull();
    expect(cleanFilters([])).toBeNull();
    expect(cleanFilters('roles')).toBeNull();
  });

  it('moves unknown keys and wrong types to unsupported (FR-2.3), so they return nobody', () => {
    expect(cleanFilters({ location: 'NYC' })).toEqual({ filters: { unsupported: [{ text: 'location: NYC', reason: 'unsupported' }] }, runnable: false });
    expect(cleanFilters({ roles: 'Data Scientist' })!.runnable).toBe(false);
    expect(cleanFilters({ min_years: '5' })!.runnable).toBe(false);
    expect(cleanFilters({ "1=1; drop table candidates": true })!.runnable).toBe(false);
  });

  it('treats inherited object names ("toString", "__proto__") as unknown keys, never as filters', () => {
    expect(cleanFilters({ toString: ['x'] })).toEqual({ filters: { unsupported: [{ text: 'toString: ["x"]', reason: 'unsupported' }] }, runnable: false });
    expect(cleanFilters(JSON.parse('{"__proto__":["x"],"constructor":["y"]}'))!.runnable).toBe(false);
  });

  it('keeps impossible year bounds, so "more than 15 years" returns nobody instead of the 15-year people', () => {
    expect(cleanFilters({ roles: ['Recruiter'], min_years: 16 })!.filters).toEqual({ roles: ['Recruiter'], min_years: 16 });
    expect(cleanFilters({ roles: ['Recruiter'], max_years: -1 })!.filters).toEqual({ roles: ['Recruiter'], max_years: -1 });
  });

  it('rounds year bounds the safe way: "at least 2.5" is 3+, "at most 2.5" is 2 or less', () => {
    expect(cleanFilters({ min_years: 2.5, max_years: 7.5 })!.filters).toEqual({ min_years: 3, max_years: 7 });
    expect(cleanFilters({ min_years: 0.2 })!.filters).toEqual({ min_years: 1 });
  });

  it('drops a list that names every possible value: it narrows nothing, so it cannot be a way to get everyone', () => {
    const everyCity = [...VOCAB.cities];
    expect(cleanFilters({ cities: everyCity })).toEqual({ filters: {}, runnable: false });
    expect(cleanFilters({ cities: everyCity, seniorities: [...VOCAB.seniorities], roles: [...VOCAB.roles] })).toEqual({ filters: {}, runnable: false });
    expect(cleanFilters({ cities: everyCity, roles: ['Recruiter'] })).toEqual({ filters: { roles: ['Recruiter'] }, runnable: true });
    // "has ALL these skills" with every skill still narrows (to nobody), so it stays.
    expect(cleanFilters({ skills: [...VOCAB.skills] })!.filters.skills).toHaveLength(VOCAB.skills.length);
  });

  it('never fails on odd model output: trims and caps unsupported, dedupes', () => {
    const many = cleanFilters({ unsupported: Array.from({ length: 30 }, (_, i) => ({ text: `x${i}`.padEnd(200, 'y'), reason: 'unsupported' })) })!;
    expect(many.filters.unsupported).toHaveLength(20);
    expect(many.filters.unsupported![0].text).toHaveLength(120);
    expect(cleanFilters({ cities: ['London', 'London'], unsupported: [{ text: '  ', reason: 'unclear' }] })!.filters.unsupported).toEqual([{ text: 'London', reason: 'unsupported' }]);
  });
});
