import { describe, it, expect } from 'vitest';
import { parsePatch, formatForClaude, validLines } from '../../src/diff-parser.js';

// ---------------------------------------------------------------------------
// parsePatch
// ---------------------------------------------------------------------------

describe('parsePatch', () => {
  it('parses a simple added line', () => {
    const patch = '@@ -0,0 +1,1 @@\n+hello world';
    const result = parsePatch(patch);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ line: 1, content: 'hello world', added: true });
  });

  it('does not include deleted lines in output', () => {
    const patch = '@@ -1,1 +1,0 @@\n-removed line';
    const result = parsePatch(patch);

    expect(result).toHaveLength(0);
  });

  it('includes context lines with added: false', () => {
    const patch = '@@ -1,3 +1,3 @@\n context line\n+added line\n context line 2';
    const result = parsePatch(patch);

    // context lines have added: false, added lines have added: true
    const contextLines = result.filter(l => !l.added);
    const addedLines   = result.filter(l => l.added);

    expect(contextLines).toHaveLength(2);
    expect(addedLines).toHaveLength(1);
    expect(contextLines[0]).toEqual({ line: 1, content: 'context line', added: false });
    expect(addedLines[0]).toEqual({ line: 2, content: 'added line', added: true });
    expect(contextLines[1]).toEqual({ line: 3, content: 'context line 2', added: false });
  });

  it('correctly increments line numbers across context and added lines', () => {
    const patch = '@@ -5,2 +5,3 @@\n unchanged\n+new\n still here';
    const result = parsePatch(patch);

    expect(result[0].line).toBe(5);
    expect(result[1].line).toBe(6);
    expect(result[2].line).toBe(7);
  });

  it('handles multiple hunks and resets line counter per hunk', () => {
    const patch =
      '@@ -1,1 +1,1 @@\n+line in hunk one\n' +
      '@@ -10,1 +10,1 @@\n+line in hunk two';
    const result = parsePatch(patch);

    expect(result).toHaveLength(2);
    expect(result[0].line).toBe(1);
    expect(result[1].line).toBe(10);
  });

  it('returns an empty array for an empty patch string', () => {
    expect(parsePatch('')).toEqual([]);
  });

  it('handles a hunk header with no context lines', () => {
    const patch = '@@ -0,0 +1,2 @@\n+first\n+second';
    const result = parsePatch(patch);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ line: 1, content: 'first', added: true });
    expect(result[1]).toEqual({ line: 2, content: 'second', added: true });
  });

  it('handles hunk header without optional comma-count syntax', () => {
    // e.g. @@ -1 +1 @@ (single-line hunks omit ,count)
    const patch = '@@ -1 +1 @@\n+replaced';
    const result = parsePatch(patch);

    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
  });

  it('ignores deleted lines without disturbing the new-file line counter', () => {
    const patch = '@@ -1,3 +1,2 @@\n context\n-deleted\n+added';
    const result = parsePatch(patch);

    // context => line 1, deleted => skipped (no counter bump), added => line 2
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ line: 1, content: 'context', added: false });
    expect(result[1]).toEqual({ line: 2, content: 'added', added: true });
  });
});

// ---------------------------------------------------------------------------
// validLines
// ---------------------------------------------------------------------------

describe('validLines', () => {
  it('returns a Set of new-file line numbers for added and context lines', () => {
    const patch = '@@ -1,3 +1,3 @@\n context\n+added\n another context';
    const lines = validLines(patch);

    expect(lines).toBeInstanceOf(Set);
    expect(lines.has(1)).toBe(true); // context
    expect(lines.has(2)).toBe(true); // added
    expect(lines.has(3)).toBe(true); // context
  });

  it('excludes deleted lines (they have no new-file line number)', () => {
    const patch = '@@ -1,2 +1,1 @@\n context\n-deleted';
    const lines = validLines(patch);

    // Only line 1 (context) should be in the set; deleted lines don't appear
    expect(lines.size).toBe(1);
    expect(lines.has(1)).toBe(true);
  });

  it('returns an empty Set for an empty patch', () => {
    expect(validLines('').size).toBe(0);
  });

  it('includes all added lines across multiple hunks', () => {
    const patch =
      '@@ -1,0 +1,1 @@\n+alpha\n' +
      '@@ -20,0 +20,1 @@\n+beta';
    const lines = validLines(patch);

    expect(lines.has(1)).toBe(true);
    expect(lines.has(20)).toBe(true);
    expect(lines.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// formatForClaude
// ---------------------------------------------------------------------------

describe('formatForClaude', () => {
  it('includes the filename and status in the header', () => {
    const patch = '@@ -0,0 +1,1 @@\n+line';
    const output = formatForClaude('src/foo.ts', patch, 'added');

    expect(output).toContain('src/foo.ts');
    expect(output).toContain('[added]');
  });

  it('uses [+] prefix for added lines', () => {
    const patch = '@@ -0,0 +1,1 @@\n+new code';
    const output = formatForClaude('file.ts', patch, 'modified');

    expect(output).toContain('[+]');
    expect(output).toContain('new code');
  });

  it('uses "   " (three spaces) prefix for context lines, not [+]', () => {
    const patch = '@@ -1,1 +1,1 @@\n context here';
    const output = formatForClaude('file.ts', patch, 'modified');

    expect(output).not.toContain('[+]');
    // Context lines begin with "   L"
    expect(output).toMatch(/   L\d+:/);
  });

  it('formats line numbers as L<N>', () => {
    const patch = '@@ -0,0 +5,2 @@\n+first\n+second';
    const output = formatForClaude('file.ts', patch, 'modified');

    expect(output).toContain('L5:');
    expect(output).toContain('L6:');
  });

  it('returns a header-only string for an empty patch body', () => {
    const output = formatForClaude('empty.ts', '', 'added');

    expect(output).toContain('empty.ts');
    expect(output).toContain('[added]');
    // No lines means no "[+]" or "L<N>:" patterns
    expect(output).not.toContain('[+]');
    expect(output).not.toMatch(/L\d+:/);
  });

  it('does not include deleted-line content in the output', () => {
    const patch = '@@ -1,1 +1,1 @@\n-old code\n+new code';
    const output = formatForClaude('file.ts', patch, 'modified');

    expect(output).not.toContain('old code');
    expect(output).toContain('new code');
  });
});
