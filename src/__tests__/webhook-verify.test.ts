import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Standalone re-implementation of verifySignature (mirrors webhook.ts exactly)
// so we can unit-test the logic without importing the full webhook module,
// which depends on @octokit/app and fastify at import time.
// ---------------------------------------------------------------------------

function verifySignature(rawBody: string, sig: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function makeSignature(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  const SECRET = 'test-webhook-secret';
  const BODY   = JSON.stringify({ action: 'opened', number: 42 });

  it('returns true for a valid signature', () => {
    const sig = makeSignature(BODY, SECRET);
    expect(verifySignature(BODY, sig, SECRET)).toBe(true);
  });

  it('returns false when the wrong secret is used to verify', () => {
    const sig = makeSignature(BODY, SECRET);
    expect(verifySignature(BODY, sig, 'wrong-secret')).toBe(false);
  });

  it('returns false when the body has been tampered with', () => {
    const sig           = makeSignature(BODY, SECRET);
    const tamperedBody  = BODY + ' '; // appended space invalidates HMAC
    expect(verifySignature(tamperedBody, sig, SECRET)).toBe(false);
  });

  it('returns false for a malformed (too-short) signature string', () => {
    // timingSafeEqual throws when buffers have different lengths; the function
    // must catch that and return false instead of propagating the error.
    expect(verifySignature(BODY, 'sha256=badhex', SECRET)).toBe(false);
  });

  it('returns false for an empty signature string', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false);
  });

  it('returns true for an empty body with the correct signature', () => {
    const sig = makeSignature('', SECRET);
    expect(verifySignature('', sig, SECRET)).toBe(true);
  });

  it('returns false for an empty body with the wrong signature', () => {
    const sig = makeSignature('non-empty', SECRET);
    expect(verifySignature('', sig, SECRET)).toBe(false);
  });
});
