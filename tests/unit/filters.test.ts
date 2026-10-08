import { describe, expect, it } from 'vitest';
import { cleanFilters } from '@/lib/shared/filters';

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
    expect(cleanFilters({ min_years: 0, max_years: 15, open_to_work: false, roles: [] })).toEqual({ filters: {}, runnable: false });
    expect(cleanFilters({})).toEqual({ filters: {}, runnable: false });
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

  it('never fails on odd model output: clamps years, trims and caps unsupported, dedupes', () => {
    expect(cleanFilters({ roles: ['Recruiter'], min_years: 40, max_years: -2 })!.filters).toEqual({ roles: ['Recruiter'], min_years: 15, max_years: 0 });
    const many = cleanFilters({ unsupported: Array.from({ length: 30 }, (_, i) => ({ text: `x${i}`.padEnd(200, 'y'), reason: 'unsupported' })) })!;
    expect(many.filters.unsupported).toHaveLength(20);
    expect(many.filters.unsupported![0].text).toHaveLength(120);
    expect(cleanFilters({ cities: ['London', 'London'], unsupported: [{ text: '  ', reason: 'unclear' }] })!.filters.unsupported).toEqual([{ text: 'London', reason: 'unsupported' }]);
  });
});
