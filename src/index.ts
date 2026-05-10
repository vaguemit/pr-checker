import 'dotenv/config';
import Fastify from 'fastify';
import { App } from '@octokit/app';
import { createWebhookHandler } from './webhook.js';

const server = Fastify({ logger: true });

// Parse JSON but keep the raw body string for HMAC signature verification.
// Fastify's default parser discards the raw bytes; re-implementing it here
// lets the webhook handler read (req as any).rawBody before JSON.parse runs.
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as any).rawBody = body as string;
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(err as Error, undefined);
  }
});

const githubApp = new App({
  appId:     process.env.GITHUB_APP_ID!,
  privateKey: (process.env.GITHUB_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  webhooks:  { secret: process.env.GITHUB_WEBHOOK_SECRET! },
});

server.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
server.post('/webhook', createWebhookHandler(githubApp));

const port = parseInt(process.env.PORT ?? '3000', 10);
server.listen({ port, host: '0.0.0.0' }, err => {
  if (err) { server.log.error(err); process.exit(1); }
});
