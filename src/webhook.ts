import { createHmac, timingSafeEqual } from 'crypto';
import type { App } from '@octokit/app';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPRFiles, postReview } from './github.js';
import { reviewPR } from './reviewer.js';

function verifySignature(rawBody: string, sig: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

export function createWebhookHandler(githubApp: App) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sig   = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event']      as string | undefined;

    if (!sig || !verifySignature((req as any).rawBody, sig, process.env.GITHUB_WEBHOOK_SECRET!)) {
      reply.code(401).send({ error: 'Invalid signature' });
      return;
    }

    if (event !== 'pull_request') {
      reply.code(200).send({ ok: true, skipped: true });
      return;
    }

    const payload = req.body as any;

    if (!HANDLED_ACTIONS.has(payload.action)) {
      reply.code(200).send({ ok: true, skipped: true });
      return;
    }

    // Respond 202 immediately — GitHub requires a response within 10s,
    // but Claude + GitHub API calls can take 20–40s on large diffs.
    reply.code(202).send({ accepted: true });

    setImmediate(async () => {
      const { installation, pull_request: pr, repository: repo } = payload;

      try {
        const octokit = await githubApp.getInstallationOctokit(installation.id);

        const files = await getPRFiles(
          octokit as any,
          repo.owner.login,
          repo.name,
          pr.number,
        );

        const result = await reviewPR(files, {
          title:  pr.title,
          body:   pr.body ?? '',
          author: pr.user.login,
        });

        await postReview(
          octokit as any,
          repo.owner.login,
          repo.name,
          pr.number,
          pr.head.sha,
          files,
          result.comments,
          result.summary,
        );

        console.log(`✓  PR #${pr.number} reviewed — ${repo.full_name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack   = err instanceof Error ? err.stack   : undefined;
        console.error(
          `✗  PR #${pr.number} review failed — ${repo.full_name}: ${message}\n${stack ?? ''}`,
          { pr: pr.number, repo: repo.full_name, error: String(err) },
        );
      }
    });
  };
}
