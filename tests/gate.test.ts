import { describe, expect, it } from 'vitest';
import { BASE, admin, signIn } from './helpers';

describe('gate', () => {
  it('loaded all 5,000 candidates', async () => {
    const { count } = await admin().from('candidates').select('id', { count: 'exact', head: true });
    expect(count).toBe(5000);
  });

  it('both seeded recruiters can sign in', async () => {
    expect(await signIn('acme')).toBeTruthy();
    expect(await signIn('globex')).toBeTruthy();
  });

  it('serves the app on :3000', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
  });
});
