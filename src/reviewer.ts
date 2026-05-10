import Anthropic from '@anthropic-ai/sdk';
import type { PRFile, ReviewResult } from './types.js';
import { formatForClaude } from './diff-parser.js';

const anthropic = new Anthropic();

// Files that add noise but no signal
const SKIP = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|gif|svg|ico|woff2?|ttf|eot)$/,
  /^dist\//,
  /^build\//,
  /\.snap$/,
];

const REVIEW_TOOL: Anthropic.Messages.Tool = {
  name: 'submit_review',
  description: 'Submit a structured PR review with inline comments and an overall summary.',
  input_schema: {
    type: 'object' as const,
    required: ['summary', 'comments'],
    properties: {
      summary: {
        type: 'object',
        required: ['overview', 'risk_level', 'key_changes', 'concerns'],
        properties: {
          overview:    { type: 'string', description: '2–3 sentence description of what this PR does.' },
          risk_level:  { type: 'string', enum: ['low', 'medium', 'high'], description: 'Overall merge risk.' },
          key_changes: { type: 'array', items: { type: 'string' }, description: 'Bullet list of main changes.' },
          concerns:    { type: 'array', items: { type: 'string' }, description: 'Top-level issues not tied to a specific line.' },
        },
      },
      comments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'line', 'severity', 'body'],
          properties: {
            path:     { type: 'string', description: 'Exact file path shown in the diff header.' },
            line:     { type: 'integer', description: 'New-file line number — use the L<N> number shown, only on [+] lines.' },
            severity: { type: 'string', enum: ['critical', 'warning', 'suggestion', 'nit'] },
            body:     { type: 'string', description: 'Concise, actionable feedback. Explain the WHY and suggest the HOW. Max 4 sentences.' },
          },
        },
      },
    },
  },
};

export async function reviewPR(
  files: PRFile[],
  pr: { title: string; body: string; author: string },
): Promise<ReviewResult> {
  const reviewable = files.filter(f => f.patch && !SKIP.some(p => p.test(f.filename)));

  if (reviewable.length === 0) {
    return {
      summary: { overview: 'No reviewable code changes.', risk_level: 'low', key_changes: [], concerns: [] },
      comments: [],
    };
  }

  const diff = reviewable
    .map(f => formatForClaude(f.filename, f.patch!, f.status))
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [REVIEW_TOOL],
    tool_choice: { type: 'tool', name: 'submit_review' },
    system: [
      'You are a senior software engineer doing a thorough, constructive code review.',
      'Priority order: correctness → security → clarity → style.',
      'Be specific and actionable. Never flag issues without explaining why they matter.',
      'Only comment on lines marked [+]. Use the exact L<N> line number shown — do not invent numbers.',
      'Skip trivial whitespace nits. Keep comment bodies under 4 sentences.',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: `Review this PR.\n\nTitle: ${pr.title}\nAuthor: @${pr.author}\nDescription: ${pr.body || '(none)'}\n\n${diff}`,
    }],
  });

  const toolCall = response.content.find(b => b.type === 'tool_use');
  if (!toolCall || toolCall.type !== 'tool_use') throw new Error('No structured review returned');

  return toolCall.input as ReviewResult;
}
