import { describe, expect, it } from 'vitest';
import { membership } from '@/components/shortlist-model';

const lists = [
  { id: '1', name: 'Frontend NYC', count: 2, candidate_ids: ['cand_0001', 'cand_0002'] },
  { id: '2', name: 'Backend', count: 1, candidate_ids: ['cand_0001'] },
  { id: '3', name: 'Senior hires', count: 0, candidate_ids: [] },
];

describe('membership', () => {
  it('not on any list: an invitation to shortlist', () => {
    expect(membership(lists, 'cand_0009')).toMatchObject({ names: [], button: 'Shortlist', short: '' });
  });
  it('on one list: names it', () => {
    expect(membership(lists, 'cand_0002')).toMatchObject({ names: ['Frontend NYC'], button: 'Frontend NYC', short: '1' });
  });
  it('on several lists: counts them, and lists them first in the menu', () => {
    const m = membership(lists, 'cand_0001');
    expect(m).toMatchObject({ names: ['Frontend NYC', 'Backend'], button: '2 lists', short: '2' });
    expect(m.ordered.map((l) => [l.name, l.member])).toEqual([['Frontend NYC', true], ['Backend', true], ['Senior hires', false]]);
  });
});
