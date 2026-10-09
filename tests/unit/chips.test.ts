import { describe, expect, it } from 'vitest';
import { ENGINEERING_ROLES, chipsOf, removeChip, replaceGroup, replaceValue, setScalar } from '@/components/search/chip-model';

const f = {
  seniorities: ['senior'], skills: ['React', 'AWS'], cities: ['New York'], worked_at_company_type: 'startup' as const,
  unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' as const }],
};

describe('chip model', () => {
  it('groups "not engineers" into one chip, and shows "worked at all of" per company', () => {
    const eng = ['Backend Engineer', 'Data Engineer', 'DevOps Engineer', 'Frontend Engineer', 'Full Stack Engineer', 'Machine Learning Engineer', 'Mobile Engineer'];
    const chips = chipsOf({ cities: ['Boston'], not_roles: eng, all_companies: ['Fernway', 'Saltbox'] });
    expect(chips.map((c) => (c.kind === 'unsupported' ? '' : `${c.label}:${c.text}`))).toEqual([
      'Not a:Any engineer', 'City:Boston', 'Worked at all of:Fernway', 'Worked at all of:Saltbox',
    ]);
    const group = chips.find((c) => c.kind === 'group')!;
    expect(removeChip({ cities: ['Boston'], not_roles: [...eng, 'Recruiter'] }, group)).toEqual({ cities: ['Boston'], not_roles: ['Recruiter'] });
    expect(replaceGroup({ not_roles: eng }, 'Recruiter', 'not_roles')).toEqual({ not_roles: ['Recruiter'] });
  });

  it('shows exclusions as their own chips', () => {
    const chips = chipsOf({ roles: ['Recruiter'], not_skills: ['Java'], not_companies: ['Saltbox'], never_company_type: 'startup' });
    expect(chips.map((c) => (c.kind === 'unsupported' ? '' : `${c.label}:${c.text}`))).toEqual([
      'Role:Recruiter', "Doesn't know:Java", 'Never worked at:Saltbox', 'Never worked at a:startup',
    ]);
  });

  it('makes one chip per value, plus scalar and unsupported chips', () => {
    expect(chipsOf(f).map((c) => (c.kind === 'unsupported' ? `!${c.text}` : `${c.label}:${c.text}`))).toEqual([
      'Seniority:Senior', 'City:New York', 'Skill:React', 'Skill:AWS', 'Worked at a:startup', '!speaks Japanese',
    ]);
  });

  it('shows open_to_work false as "Not open to work"', () => {
    expect(chipsOf({ open_to_work: false }).map((c) => c.text)).toEqual(['Not open to work']);
    expect(chipsOf({ open_to_work: true }).map((c) => c.text)).toEqual(['Open to work']);
  });

  it('removes exactly one value, and drops the key when it was the last', () => {
    const chips = chipsOf(f);
    expect(removeChip(f, chips.find((c) => c.kind === 'list' && c.value === 'AWS')!).skills).toEqual(['React']);
    expect(removeChip(f, chips.find((c) => c.kind === 'list' && c.value === 'New York')!)).not.toHaveProperty('cities');
    expect(removeChip(f, chips.find((c) => c.kind === 'unsupported')!)).not.toHaveProperty('unsupported');
    expect(removeChip(f, chips.find((c) => c.kind === 'scalar')!)).not.toHaveProperty('worked_at_company_type');
  });

  it('replaces or adds a value without duplicates, and never mutates the input', () => {
    expect(replaceValue(f, 'cities', 'New York', 'Boston').cities).toEqual(['Boston']);
    expect(replaceValue(f, 'skills', null, 'Go').skills).toEqual(['React', 'AWS', 'Go']);
    expect(replaceValue(f, 'skills', 'AWS', 'React').skills).toEqual(['React']);
    expect(setScalar(f, 'min_years', 5).min_years).toBe(5);
    expect(f.skills).toEqual(['React', 'AWS']);
  });

  it('shows every engineering role as one "Any engineer" chip ("engineers in Texas" would otherwise be 7 chips)', () => {
    const g = { roles: [...ENGINEERING_ROLES], skills: ['React'] };
    const chips = chipsOf(g);
    expect(chips.map((c) => (c.kind === 'unsupported' ? '' : `${c.label}:${c.text}`))).toEqual(['Role:Any engineer', 'Skill:React']);
    expect(removeChip(g, chips[0])).toEqual({ skills: ['React'] });
    expect(replaceGroup(g, 'Frontend Engineer')).toEqual({ roles: ['Frontend Engineer'], skills: ['React'] });
    // A partial set stays as separate chips.
    expect(chipsOf({ roles: ['Frontend Engineer', 'Backend Engineer'] })).toHaveLength(2);
  });
});
