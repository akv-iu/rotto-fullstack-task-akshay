import { describe, expect, it } from 'vitest';
import { chipsOf, removeChip, replaceValue, setScalar } from '@/components/search/chip-model';

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
});
