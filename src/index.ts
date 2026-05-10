import 'dotenv/config';
import Fastify from 'fastify';
import { App } from '@octokit/app';
import { createWebhookHandler } from './webhook.js';

function validateEnv(): void {
  const required = [
    'GITHUB_APP_ID',
    'GITHUB_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
    'ANTHROPIC_API_KEY',
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

validateEnv();

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
