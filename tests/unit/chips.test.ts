import { describe, expect, it } from 'vitest';
import { ENGINEERING_ROLES, chipsOf, removeChip, replaceGroup, replaceValue, setScalar } from '@/components/search/chip-model';

const f = {
  seniorities: ['senior'], skills: ['React', 'AWS'], cities: ['New York'], worked_at_company_type: 'startup' as const,
  unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' as const }],
};

describe('chip model', () => {
  it('makes one chip per value, plus scalar and unsupported chips', () => {
    expect(chipsOf(f).map((c) => (c.kind === 'unsupported' ? `!${c.text}` : `${c.label}:${c.text}`))).toEqual([
      'Seniority:Senior', 'City:New York', 'Skill:React', 'Skill:AWS', 'Worked at a:startup', '!speaks Japanese',
    ]);
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
