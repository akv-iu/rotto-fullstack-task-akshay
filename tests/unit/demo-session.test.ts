import { afterEach, describe, expect, it, vi } from 'vitest';

const { signInAnonymously } = vi.hoisted(() => ({ signInAnonymously: vi.fn() }));
vi.mock('@/lib/client/supabase', () => ({ supabase: { auth: { signInAnonymously } } }));
import { startDemoSession } from '@/lib/client/demo-session';
afterEach(() => signInAnonymously.mockReset());

describe('anonymous demo sessions', () => {
  it('shares a concurrent sign-in so StrictMode creates only one visitor', async () => {
    let finish!: (response: unknown) => void;
    signInAnonymously.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = startDemoSession();
    const second = startDemoSession();
    expect(signInAnonymously).toHaveBeenCalledOnce();
    finish({ data: { session: { access_token: 'test' } }, error: null });
    expect(await first).toEqual({ access_token: 'test' });
    expect(await second).toEqual({ access_token: 'test' });
  });

  it('offers a friendly error and lets the next attempt retry', async () => {
    signInAnonymously.mockResolvedValueOnce({ data: { session: null }, error: { message: 'anonymous sign-ins disabled' } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'test' } }, error: null });
    await expect(startDemoSession()).rejects.toThrow("We couldn't start the demo. Please try again.");
    expect(await startDemoSession()).toEqual({ access_token: 'test' });
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
