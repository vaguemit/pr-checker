interface DiffLine {
  line:    number;
  content: string;
  added:   boolean;
}

export function parsePatch(patch: string): DiffLine[] {
  const result: DiffLine[] = [];
  let n = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      // @@ -old_start,count +new_start,count @@
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) n = parseInt(m[1], 10) - 1;
    } else if (raw.startsWith('+')) {
      result.push({ line: ++n, content: raw.slice(1), added: true });
    } else if (raw.startsWith('-')) {
      // deleted line — no new-file line number
    } else if (raw.length > 0) {
      result.push({ line: ++n, content: raw.slice(1), added: false });
    }
  }

  return result;
}

export function formatForClaude(filename: string, patch: string, status: string): string {
  const lines = parsePatch(patch);
  const body = lines
    .map(l => `${l.added ? '[+]' : '   '} L${l.line}: ${l.content}`)
    .join('\n');
  return `### ${filename}  [${status}]\n${body}`;
}

// Returns every line number that exists in the diff — used to validate Claude's output
// before posting, since GitHub rejects comments on lines outside any hunk.
export function validLines(patch: string): Set<number> {
  return new Set(parsePatch(patch).map(l => l.line));
}
