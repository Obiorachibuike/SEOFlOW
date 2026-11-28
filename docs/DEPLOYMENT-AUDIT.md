# Deployment audit and unification decision

Status: complete (Phase 1 and Phase 2 of the unified-platform program)
Date: 2026-11-28 · Author: release engineering (Arena agent) · Repo: `Obiorachibuike/SEOFlOW`

> Method note: every fact below is verifiable from (a) the repository, (b) the Vercel
> project/deployment API for team `obiorachibuike's projects` (`team_bKjmW1MAhdOwvZ7v4gYdxnrU`),
> and (c) GitGuardian/Vercel notification mail. **No secret values are recorded here** — env
> vars are listed by name/target only. No AWS account internals are read or reproduced.

## TL;DR — the premise, corrected

SEOFlow is not two codebases. It is **one repository deployed as two separate Vercel
production projects with divergent environment configuration**. Deployment B ("AWS
deployment") has never run a different implementation; it is the same Next.js app on the
same commit, missing the auth/email configuration and carrying an AWS integration the
application code never reads. There is no Cognito, no Amplify, no second database, and
no second user inventory to migrate.

Consequences:

- There is nothing to "merge" file-by-file; the merge is **configuration + AWS capability
  support in code + one canonical Vercel project**.
- No user migration is required: both deployments run Better Auth against the same
  PostgreSQL schema (or fail closed). Keeping the one codebase and unifying env on the
  canonical project preserves identity by construction.
- No schema migration is required for the consolidation itself. The Drizzle migration
  history is unchanged.

## The two deployments

### Deployment A — Vercel project `seoflow` ("Better Auth deployment")

| Area | Finding |
| --- | --- |
| Project ID | `prj_lt8FxA2f4AQk5PBb6sDjczwVpGbh` |
| Canonical domain | `seoflow-rose.vercel.app` (+ automatic team aliases) |
| Git link | `Obiorachibuike/SEOFlOW`, production branch `main`, repoId `1467411277` |
| Plan / protection | Hobby · SSO protection `all_except_custom_domains` |
| Production env (names only) | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (= `https://seoflow-rose.vercel.app`), `NEXT_PUBLIC_APP_URL` (same origin), `SECRETS_ENCRYPTION_KEY` |
| Latest production deployment | `dpl_4UGgdMjaozMNikVZUkRSdpGNL1gY` — READY / PROMOTED, forced redeploy of `dpl_4KcL3myHHdkpCByscaXTfziM7Qr8`, commit `6b7673e` |
| Better Auth | Configured (secret, URL, app URL, encryption key all present) |
| AWS / object storage | **None.** No `S3_*`, no AWS integration — report archival disabled; exports stream on demand |

### Deployment B — Vercel project `seo-fl-ow` ("AWS deployment")

| Area | Finding |
| --- | --- |
| Project ID | `prj_sjPOFcRZeG5blk4j0gv6zzXPd3K3` |
| Canonical domain | `seo-fl-ow.vercel.app` (+ automatic team aliases) |
| Git link | Same repo, production branch `main`, `sourceless: true`; created 2026-11-26 |
| Plan / protection | Hobby · SSO protection `all_except_custom_domains` |
| Production env (names only) | `DATABASE_URL` (production+preview) plus AWS integration vars `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_RESOURCE_ARN`, `AWS_ROLE_ARN`, `S3_BUCKET_NAME` — all `sensitive`, all provided by a Vercel AWS integration (integration-store-backed; integration config `icfg_qkPhN37NCsEfItoWFweJt7xL`, store `store_Cs52nWw6O6gHbAZ2`) |
| Missing | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `SECRETS_ENCRYPTION_KEY` → in production, auth **fails closed** (`resolveSecret()` / `resolveAppUrl()` throw; sign-in/sign-up unusable) · no `SECRETS_ENCRYPTION_KEY` → AI/search-console token encryption unusable |
| Latest production deployment | `dpl_BbUVDUFgefJiymZz3swsDSTBHatf` — READY / PROMOTED, commit `6b7673e` |
| AWS usage in code | **None.** The codebase reads only `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_ENDPOINT` (static credentials). `AWS_ROLE_ARN` / `AWS_ACCOUNT_ID` / `AWS_RESOURCE_ARN` / `S3_BUCKET_NAME` / `VERCEL_OIDC_TOKEN` are referenced nowhere → the integration was provisioned but never wired into the app |
| SES | Not configured; email is nodemailer/SMTP only, and production without `SMTP_*` fails closed |

### Shared codebase (both deploy from commit `6b7673e`)

Next.js 15.5.29 · React 19.2 · strict TypeScript · Better Auth 1.7.27 (drizzle adapter,
PostgreSQL) · Drizzle ORM 0.45.4 + `pg` pool (lazy singleton, `sslmode`-honoured TLS,
bounded pool, classified errors) · pg-boss persistent crawl worker · Vitest unit tests ·
Playwright E2E · no GitHub Actions CI · Drizzle migration history `0000`–`0003`.
Features: email/password + verification + reset, optional Google sign-in, workspaces,
roles/invitations, projects, robots-aware bounded crawls, SSE progress, AI task routing
(encrypted provider credentials), tracked keywords, Search Console, DataForSEO,
Stripe/Paystack billing, PDF/CSV exports (optional archive to S3-compatible storage),
admin plans/AI consoles, structured JSON logging, health diagnostics.

## Comparison and decisions

| Area | Deployment A | Deployment B | Final decision |
| --- | --- | --- | --- |
| Application architecture | Next.js App Router, worker split web/pg-boss | identical (same commit) | Keep single codebase; no restructuring |
| Authentication | Better Auth, fully configured | Better Auth present in code, **unconfigured at runtime → fails closed** | One authority: Better Auth (unchanged). No second auth system is introduced |
| Database | PostgreSQL via `DATABASE_URL` (same schema/migrations) | same variable, same schema | Single authoritative Postgres; no RDS move; no data migration |
| ORM | Drizzle ORM + `pg` | same | Keep |
| Email | SMTP via nodemailer (production fails closed without it) | none | SMTP retained as default; **Amazon SES added as first-class provider** behind the same `sendAccountEmail` abstraction (used when `EMAIL_PROVIDER=ses`) |
| Storage | S3-compatible static credentials (unused) | Vercel AWS integration: role-based S3 (unread by code) | **Role-based AWS credentials via Vercel OIDC + STS AssumeRoleWithWebIdentity**, with static-credential fallback for S3-compatible stores. Existing private-bucket, SHA-256-checked artifact flow retained |
| AWS services | none | provisioned, inert | S3 used for report archives (opt-in); SES available for account email; CloudWatch metrics publisher added (opt-in, fire-and-forget); no RDS, no Cognito, no Lambda |
| OAuth | Google optional (unconfigured) | same | unchanged |
| Billing | Stripe/Paystack adapters (env-gated) | same | unchanged |
| Monitoring | Vercel logs + health endpoints | same | same + optional CloudWatch operational metrics |
| Tests | Vitest suite + Playwright E2E | same | suite extended; new unit tests for AWS/SES/CloudWatch layers |

## Defects found in the current state

1. **Duplicate production deployments of one commit with divergent env** — signup/login
   broken on `seo-fl-ow` (missing auth env), storage unavailable on `seoflow`
   (missing AWS env). Both fail, differently, from the same code.
2. **AWS integration on B is inert** — no code path consumes `AWS_ROLE_ARN` /
   `AWS_ACCOUNT_ID` / `AWS_REGION` / `S3_BUCKET_NAME`; Vercel OIDC tokens
   (`VERCEL_OIDC_TOKEN`) are unused. No STS call exists anywhere.
3. **No SES capability** despite an AWS account wired to one project; email is
   SMTP-only and fails closed in production without SMTP.
4. **No CI workflow** — typecheck/lint/test/build are documented but not enforced on PRs.
5. Two deployments failed for `main` at `e3949ec` and `f2e92fc` (2026-11-26/27, before the
   `#2` hotfix). Current `main` (`6b7673e`) deploys READY. GitGuardian history: 2 secrets
   flagged on PR #1 (June 2026; `.env.example` carries placeholders only — no committed
   secret material found in the current tree).

## Decision and plan

**Foundation: Deployment A (`seoflow`) is the canonical production project.** It is the
only deployment whose complete user-facing surface (auth, URLs, encryption) is configured.
Deployment B contributes its AWS integration (role, account, region, bucket), which is
brought into the shared codebase and then into the canonical project.

Plan:

1. Add a shared AWS layer in code: region/bucket resolution accepting both Vercel
   integration names (`AWS_REGION`, `S3_BUCKET_NAME`, `AWS_ROLE_ARN`) and the existing
   static-credential names (`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
   Credentials: `VERCEL_OIDC_TOKEN` + STS `AssumeRoleWithWebIdentity` (role-based,
   preferred) with cached temporary credentials; static keys as explicit fallback.
2. Route object storage through that layer; keep the private-artifact model (server-side
   authorized reads with SHA-256 verification; never public bucket URLs).
3. Add Amazon SES as an optional transactional email provider (`EMAIL_PROVIDER=ses`,
   `SES_FROM_EMAIL`); SMTP remains the default when configured; production still fails
   closed rather than silently dropping mail.
4. Add an opt-in CloudWatch operational-metrics publisher (no-ops unless enabled);
   never throws, never logs secrets.
5. One canonical production deployment: re-point AWS/Better Auth env at `seoflow`,
   redeploy from merged `main`, smoke-check deployment state, and retire `seo-fl-ow`
   only after stability (it stays running in the interim). A host-based redirect of
   `seo-fl-ow.vercel.app` → canonical is prepared in code and activated by env, so the
   duplicate entry point fails safe during transition.
6. Add GitHub Actions CI (typecheck · lint · unit tests · build) so "green main" is
   enforceable.

## Out of scope / not performed (and why)

- **User data migration between auth providers — not applicable.** Both deployments are
  the same Better Auth system; there is no Cognito/Amplify user pool to export.
  `seo-fl-ow` could never complete a sign-up (missing secret), so it holds no divergent
  identity data. Password continuity is trivially preserved: no password hashes move.
- **Database migration to AWS RDS — rejected.** No technical or business requirement;
  current PostgreSQL provider stays authoritative.
- **Deletion/pause of `seo-fl-ow`** — left running per safe-transition policy; retirement
  steps are in `docs/DEPLOYMENT.md`.
- **Live AWS calls** (SES send, S3 put/get, CloudWatch put-metric) — automated tests mock
  AWS; real-account validation requires the production role and is a deployment-gate step
  documented for the operator. No AWS credentials are present in this workspace.
