import type { PRFile, ReviewComment, ReviewSummary } from './types.js';
import { validLines } from './diff-parser.js';

type OctokitLike = { request: (route: string, opts?: any) => Promise<any> };

const SEVERITY_EMOJI = { critical: '🔴', warning: '🟡', suggestion: '🔵', nit: '⚪' } as const;
const RISK_EMOJI     = { low: '🟢', medium: '🟡', high: '🔴' } as const;

export async function getPRFiles(
  octokit:    OctokitLike,
  owner:      string,
  repo:       string,
  pullNumber: number,
): Promise<PRFile[]> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
    owner, repo, pull_number: pullNumber, per_page: 100,
  });
  return res.data.map((f: any) => ({
    filename:  f.filename,
    status:    f.status,
    patch:     f.patch,
    additions: f.additions,
    deletions: f.deletions,
  }));
}

export async function postReview(
  octokit:    OctokitLike,
  owner:      string,
  repo:       string,
  pullNumber: number,
  headSha:    string,
  files:      PRFile[],
  comments:   ReviewComment[],
  summary:    ReviewSummary,
): Promise<void> {
  // Build validity map — GitHub rejects comments on lines outside diff hunks
  const lineMap = new Map<string, Set<number>>();
  for (const f of files) {
    if (f.patch) lineMap.set(f.filename, validLines(f.patch));
  }

  const validComments = comments.filter(c => lineMap.get(c.path)?.has(c.line) ?? false);

  const body = buildBody(summary);

  try {
    await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner,
      repo,
      pull_number: pullNumber,
      commit_id:   headSha,
      event:       'COMMENT',
      body,
      comments: validComments.map(c => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT',
        body: `${SEVERITY_EMOJI[c.severity]} **${c.severity}**\n\n${c.body}`,
      })),
    });
  } catch (err) {
    console.warn('Review with inline comments failed — falling back to summary-only comment:', err);
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner, repo, issue_number: pullNumber,
      body: body + '\n\n> ⚠️ Inline comments could not be posted (diff position mismatch).',
    });
  }
}

function buildBody(s: ReviewSummary): string {
  const lines = [
    '## 🤖 AI Code Review',
    '',
    `**Risk:** ${RISK_EMOJI[s.risk_level]} \`${s.risk_level.toUpperCase()}\``,
    '',
    s.overview,
  ];

  if (s.key_changes.length) {
    lines.push('', '**Key changes**');
    s.key_changes.forEach(c => lines.push(`- ${c}`));
  }

  if (s.concerns.length) {
    lines.push('', '**Concerns**');
    s.concerns.forEach(c => lines.push(`- ${c}`));
  }

  lines.push(
    '',
    '---',
    '*Powered by [claude-reviewer](https://github.com/vaguemit/claude-reviewer) · Claude Sonnet 4.6*',
  );

  return lines.join('\n');
}
