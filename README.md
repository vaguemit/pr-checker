# claude-reviewer

> **Automated, line-level code review for every pull request — powered by Claude Sonnet 4.6.**

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify&logoColor=white)

---

## What it does

`claude-reviewer` is a self-hosted GitHub App that automatically reviews every pull request the moment it is opened, updated, or reopened. It fetches the diff file-by-file, sends it to Claude Sonnet 4.6 using forced structured output (`tool_use`), and posts the result directly into GitHub's review UI — inline comments anchored to exact changed lines, plus a summary card at the top.

The reviewer catches **bugs and logic errors**, **security vulnerabilities** (missing auth checks, injection risks, secret exposure), **API misuse and type unsafety**, and **style or clarity issues** that slow down human reviewers. Every comment is classified with a severity level so teams can triage at a glance: stop-the-merge criticals surface immediately, while nits stay out of the way.

Because Claude API calls can take 20–40 seconds on large diffs, the server responds `202 Accepted` to GitHub immediately (within the required 10-second window) and processes the review asynchronously in the background.

---

## Example review

> **Inline comment — posted directly on the changed line**
>
> ---
> 🔴 **critical**
>
> `getUserById` returns `null` when the user is not found, but the caller on line 42 dereferences `.email` without a null check. This will throw a `TypeError` at runtime for any unauthenticated request. Add an explicit null guard or throw a typed `NotFoundError` before accessing the property.
>
> ---
> 🟡 **warning**
>
> The JWT secret is read from `process.env.JWT_SECRET` without a fallback check at startup. If the variable is missing in production the server will start successfully and silently sign tokens with `undefined`, making all tokens trivially forgeable. Validate required env vars at boot time and exit early if any are absent.
>
> ---
> **Summary card — posted as the review body**
>
> ## 🤖 AI Code Review
>
> **Risk:** 🔴 `HIGH`
>
> This PR adds a user authentication flow with JWT issuance and a protected `/profile` endpoint. The core logic is sound but there are two critical gaps — a missing null check on the user lookup and an unvalidated JWT secret — that must be resolved before merge.
>
> **Key changes**
> - Added `POST /auth/login` endpoint with bcrypt password verification
> - Added `GET /profile` route protected by JWT middleware
> - Introduced `UserService` with `getUserById` and `validatePassword` helpers
>
> **Concerns**
> - JWT secret is never validated at startup — see inline comment on `auth.ts:18`
> - No rate limiting on `/auth/login`, leaving it open to brute-force attacks

---

## Features

- **Guaranteed structured output** — uses Claude's `tool_use` with `tool_choice: { type: "tool" }` so the response is always valid JSON. No regex parsing, no hallucinated formats.
- **Line-level inline comments** — comments are anchored to exact `+` lines in the diff, validated against GitHub's accepted hunk positions before posting.
- **Four-tier severity classification** — 🔴 critical · 🟡 warning · 🔵 suggestion · ⚪ nit, so reviewers know where to focus first.
- **Summary card with risk level** — every review includes a structured overview card with 🟢 low / 🟡 medium / 🔴 high merge risk, a list of key changes, and top-level concerns not tied to a specific line.
- **Fallback safety** — if GitHub rejects the inline review (e.g. due to a diff-position mismatch on force-pushed commits), the app automatically falls back to posting the summary card as a plain PR comment so the review is never silently lost.
- **Smart file filtering** — automatically skips noise files that have no review value: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, minified `.js`/`.css`, binary assets (images, fonts), and generated `dist/` / `build/` directories.
- **HMAC-SHA256 webhook verification** — every incoming request is verified against the GitHub webhook secret using `crypto.timingSafeEqual` before any processing occurs. Unauthenticated requests are rejected with `401`.
- **202 Accepted response pattern** — responds to GitHub immediately, then processes the review asynchronously via `setImmediate`, safely decoupling the network timeout from AI latency.

---

## How it works

```
GitHub                      claude-reviewer                  Claude API
  │                               │                               │
  │  POST /webhook                │                               │
  │  (PR opened / synchronize)    │                               │
  │ ──────────────────────────>   │                               │
  │                               │  1. Verify HMAC-SHA256 sig   │
  │                               │  2. Reply 202 immediately     │
  │  <── 202 Accepted ────────────│                               │
  │                               │                               │
  │                               │  3. Fetch PR files + diffs    │
  │  <── GET /pulls/:n/files ─────│                               │
  │  ──────────────────────────>  │                               │
  │                               │                               │
  │                               │  4. Filter noise files        │
  │                               │  5. Format diff for review    │
  │                               │                               │
  │                               │  6. Call claude-sonnet-4-6    │
  │                               │     tool_choice: submit_review│
  │                               │ ────────────────────────────> │
  │                               │ <──── structured JSON ─────── │
  │                               │                               │
  │                               │  7. Validate line positions   │
  │                               │  8. POST /pulls/:n/reviews    │
  │  <── inline comments + body ──│                               │
  │     (or fallback comment)     │                               │
```

**Architecture**

```
┌─────────────────────────────────────────────────────────┐
│  src/index.ts       — Fastify server bootstrap           │
│                       raw body preservation for HMAC     │
├─────────────────────────────────────────────────────────┤
│  src/webhook.ts     — HMAC verification, 202 pattern,    │
│                       async dispatch                     │
├─────────────────────────────────────────────────────────┤
│  src/reviewer.ts    — Claude Sonnet 4.6 integration,     │
│                       tool schema, file filtering        │
├─────────────────────────────────────────────────────────┤
│  src/diff-parser.ts — Unified diff → structured lines,   │
│                       valid-line-number extraction       │
├─────────────────────────────────────────────────────────┤
│  src/github.ts      — PR file fetching, review posting,  │
│                       severity/risk emoji rendering      │
├─────────────────────────────────────────────────────────┤
│  src/types.ts       — Shared TypeScript interfaces       │
└─────────────────────────────────────────────────────────┘
```

---

## Setup: Create the GitHub App

### 1. Register the app

Go to **[github.com/settings/apps/new](https://github.com/settings/apps/new)** and fill in:

| Field | Value |
|---|---|
| **GitHub App name** | `claude-reviewer` (or any unique name) |
| **Homepage URL** | `https://github.com/vaguemit/pr-checker` |
| **Webhook URL** | `https://YOUR_DOMAIN/webhook` |
| **Webhook secret** | A strong random string — save it as `GITHUB_WEBHOOK_SECRET` |

### 2. Set permissions

Under **Permissions**, set:

| Permission | Level |
|---|---|
| **Pull requests** | Read & Write |
| **Contents** | Read |

### 3. Subscribe to events

Under **Subscribe to events**, check:

- [x] **Pull request**

### 4. Finalize

- Set **Where can this GitHub App be installed?** to `Only on this account` (or `Any account` for public use).
- Click **Create GitHub App**.
- On the next page, note your **App ID** — save it as `GITHUB_APP_ID`.
- Scroll to **Private keys** and click **Generate a private key**. A `.pem` file will be downloaded — its contents become `GITHUB_PRIVATE_KEY`.

### 5. Install the app

Go to your app's **Install App** tab and install it on the repositories you want reviewed.

---

## Environment variables

| Name | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | Yes | Numeric App ID shown on your GitHub App's settings page |
| `GITHUB_PRIVATE_KEY` | Yes | Full contents of the downloaded `.pem` file. Use `\n` for newlines when storing as a single-line secret |
| `GITHUB_WEBHOOK_SECRET` | Yes | The random string you entered in the GitHub App webhook secret field |
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |
| `PORT` | No | Port the Fastify server listens on. Defaults to `3000` |

---

## Deploy to Railway

Railway is the fastest path to a public HTTPS endpoint.

1. Push this repository to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** and select your fork.
3. In the Railway project, open **Variables** and add all five environment variables from the table above.
   - For `GITHUB_PRIVATE_KEY`, paste the entire `.pem` contents and replace literal newlines with `\n`.
4. Railway will build and deploy automatically. Open **Settings → Networking** and note your public domain, e.g. `https://claude-reviewer-production.up.railway.app`.
5. Go back to your GitHub App settings and paste that URL (with `/webhook`) into the **Webhook URL** field:
   ```
   https://claude-reviewer-production.up.railway.app/webhook
   ```
6. Open any pull request on an installed repository to confirm the review appears.

---

## Deploy to Render

1. Push this repository to GitHub.
2. Go to [render.com](https://render.com) → **New** → **Web Service** → connect your repository.
3. Set the following:

   | Setting | Value |
   |---|---|
   | **Environment** | `Node` |
   | **Build Command** | `npm install && npm run build` |
   | **Start Command** | `npm start` |

4. Add all environment variables under **Environment**.
5. Deploy. Copy the public URL Render assigns (e.g. `https://claude-reviewer.onrender.com`).
6. Paste `https://claude-reviewer.onrender.com/webhook` into the **Webhook URL** field of your GitHub App settings.

> **Note:** Free-tier Render instances spin down after inactivity. Use a paid instance or Railway for production to ensure webhook delivery never times out.

---

## Local development

### Prerequisites

- Node.js 20 or later
- An [ngrok](https://ngrok.com) account (free tier is sufficient) for exposing localhost to GitHub

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/vaguemit/pr-checker.git
cd pr-checker

# 2. Copy the example env file and fill in your values
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Start the dev server with hot reload
npm run dev
```

The server starts on `http://localhost:3000`. You can verify it is running:

```bash
curl http://localhost:3000/health
# {"ok":true,"ts":"2026-05-10T12:00:00.000Z"}
```

### Expose localhost with ngrok

```bash
# In a second terminal
ngrok http 3000
```

Copy the HTTPS forwarding URL ngrok prints (e.g. `https://abc123.ngrok-free.app`) and paste it into your GitHub App's **Webhook URL** field:

```
https://abc123.ngrok-free.app/webhook
```

Open or push to a PR on an installed repository and watch the server logs — you should see the review complete within 30 seconds.

### Build for production

```bash
npm run build   # compiles TypeScript → dist/
npm start       # runs the compiled output
```

---

## Project structure

```
pr-checker/
├── src/
│   ├── index.ts          # Fastify server bootstrap; raw body preservation for HMAC
│   ├── webhook.ts        # Signature verification, 202 pattern, async review dispatch
│   ├── reviewer.ts       # Claude Sonnet 4.6 call, tool schema, noise-file filtering
│   ├── diff-parser.ts    # Unified diff parser; extracts line numbers and added lines
│   ├── github.ts         # GitHub API: fetch PR files, post reviews, build summary card
│   └── types.ts          # Shared TypeScript interfaces (PRFile, ReviewResult, etc.)
├── package.json          # Dependencies and npm scripts (dev / build / start)
├── tsconfig.json         # TypeScript config targeting ES2022 / NodeNext modules
└── README.md
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

*Built by [@vaguemit](https://github.com/vaguemit) · Powered by [Claude Sonnet 4.6](https://anthropic.com)*
