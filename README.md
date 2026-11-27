# SEOFlow

SEOFlow is a multi-tenant SEO workspace built around observable evidence rather than synthetic analytics. Teams can manage projects, run bounded technical crawls, inspect deterministic findings, draft AI-assisted content, connect Google Search Console, obtain paid provider estimates, and export audit reports.

The app is built with Next.js App Router, strict TypeScript, Tailwind, PostgreSQL/Drizzle, Better Auth, pg-boss, Playwright/Cheerio/Undici, Zod, Vitest/Playwright E2E, and Recharts. The web app and persistent crawl worker are separate processes and may be deployed independently.

## What is implemented

- Email/password sign-up, verification and password reset; optional Google sign-in; workspace roles, invitations, project isolation and server-side authorization.
- Project creation, queued crawl jobs, persisted crawl progress exposed with SSE, cancellation, robot-policy-aware crawling, public-address/DNS-pinned HTTP requests and versioned technical SEO findings.
- Evidence-linked AI recommendations and content drafts. Providers, exact model IDs, encrypted credentials, model capabilities and task routing are configured by a platform administrator; AI output is a proposal, never an automatic site change.
- Tracked keywords, CSV exports, Search Console observations, and optional DataForSEO estimates for keyword volume/difficulty/CPC, backlink summaries and organic competitor overlap. Provider estimates are labeled separately from Search Console observations.
- PDF/CSV audit exports. Optional AWS S3 or S3-compatible storage archives exports privately; reads are project-authorized and SHA-256 checked. Without storage credentials, exports are generated on demand and streamed to the authorized user.
- Subscription plans, Stripe and Paystack adapters, checkout sessions, signed/idempotent webhooks and subscription-management actions.
- Super-admin controls for provider/model routing and plan configuration; PostgreSQL-backed usage, rate-limit and audit records.

SEOFlow does not make up search volume, rankings, traffic, backlinks or indexing results. A diagnostic score is an internal rule-based indicator, not a Google ranking score. See [architecture](docs/ARCHITECTURE.md) and [security notes](docs/SECURITY.md).

## Quick start

Requirements: Node.js **22.12+**, npm, and PostgreSQL 15+ (the local Compose file uses PostgreSQL 17). Docker is optional if PostgreSQL is already available.

```bash
cp .env.example .env
# Edit .env. Generate separate production-grade values, for example:
openssl rand -base64 48  # BETTER_AUTH_SECRET
openssl rand -base64 32  # SECRETS_ENCRYPTION_KEY (exactly 32 decoded bytes)

docker compose up -d postgres
npm ci --legacy-peer-deps
npm run db:migrate
npm run db:seed
npm run dev
```

Start the persistent worker in a **second process** using the same `DATABASE_URL`:

```bash
npm run worker
```

Then open `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000`), register an account, and verify its email. In local development, when SMTP is not configured, verification/reset links are printed in the server log. To bootstrap a platform administrator, set `ADMIN_EMAIL` to the registered account's email and run `npm run db:seed` again. Treat `ADMIN_EMAIL` as a bootstrap mechanism; remove it from routine deployment configuration after granting the role.

`docker-compose.yml` starts PostgreSQL only. It does not start the web app, worker, mail server, or external providers. See [deployment](docs/DEPLOYMENT.md) for independent web/worker rollout and health checks, and [integration setup](docs/INTEGRATIONS.md) for credentials and provider configuration.

## Reliability, health checks and error diagnostics

- `GET /api/health` — public minimal liveness/database check (`{"status":"ok"}` or `503` with `code` + `referenceId`).
- `GET /api/health/database`, `GET /api/health/auth` — detailed diagnostics (environment presence, `SELECT 1` latency, auth-schema check, pool stats). Require `Authorization: Bearer $HEALTH_DIAGNOSTICS_KEY` or a super-admin session; otherwise they return the same `404` as an unknown route.
- Authentication and database failures are classified into stable codes (`AUTH_DATABASE_ERROR`, `DATABASE_SCHEMA_ERROR`, …) and carry a per-failure **reference ID** shown to users and written to exactly one sanitized JSON log line. See [error codes and troubleshooting](docs/ERRORS.md) for the full catalogue, health-endpoint access and how to read Vercel Runtime Logs.

## Environment and integrations

Copy every deployment secret into a secret manager rather than committing `.env`. The checked-in [.env.example](.env.example) documents all supported variables. Core runtime values are `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SECRETS_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, and `BETTER_AUTH_URL`. SMTP is required to deliver verification/reset/invitation mail in production.

Third-party integrations are opt-in. Google sign-in, Search Console, Agnes AI and other compatible AI providers, DataForSEO, Stripe/Paystack and S3-compatible object storage each need their own account credentials and provider-side setup. The adapters validate and report configuration/provider errors, but their real-account behavior must be validated in the deployment's own staging environment before launch. No live credentials are included in this repository.

## Common commands

```bash
npm run dev            # Next.js development server
npm run worker         # Persistent pg-boss crawl worker (run separately)
npm run typecheck      # Strict TypeScript check
npm run lint           # ESLint
npm run test           # Vitest unit tests
npm run test:e2e       # Playwright E2E (requires Chromium and a configured DB/app)
npm run db:generate    # Generate a migration from src/db/schema.ts
npm run db:migrate     # Apply checked-in migrations
npm run db:seed        # Idempotently seed plans; optionally grant ADMIN_EMAIL
npm run build          # Production Next.js build
npm run start          # Production web server
```

Schema changes are not applied automatically on web startup. Generate, inspect and commit migrations, then run `db:migrate` as a release step. Do not generate migrations against a production database. See [testing](docs/TESTING.md) for verification scope and the E2E prerequisites.

## Operational readiness

This repository provides production-oriented code paths, but the following are deployment gates, not claims of live validation: apply and verify all migrations on PostgreSQL; provision the worker and monitoring; configure SMTP and secret management; and exercise the Google, AI, DataForSEO, payment and S3 flows with staging credentials. Automated tests do not replace provider contract tests, database integration tests, load testing or a security review.
