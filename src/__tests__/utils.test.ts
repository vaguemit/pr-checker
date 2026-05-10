import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry } from '../../src/utils.js';

// Use baseDelay=0 throughout so back-off sleeps are instant — no fake timers
// needed, which avoids PromiseRejectionHandledWarning from vi.useFakeTimers().

describe('withRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fn exactly once when it succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, 3, 0)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the value from fn without wrapping it', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    expect(await withRetry(fn, 3, 0)).toBe(42);
  });

  it('retries on failure and succeeds on the second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    expect(await withRetry(fn, 3, 0)).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on failure and succeeds on the third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('final');

    expect(await withRetry(fn, 3, 0)).toBe('final');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after maxAttempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when maxAttempts=1', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(withRetry(fn, 1, 0)).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries exactly maxAttempts times before giving up', async () => {
    const maxAttempts = 5;
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, maxAttempts, 0)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(maxAttempts);
  });

  it('re-throws non-Error rejections (e.g. strings)', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    await expect(withRetry(fn, 2, 0)).rejects.toBe('string error');
  });
});
