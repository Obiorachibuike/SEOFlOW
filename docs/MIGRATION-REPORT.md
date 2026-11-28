# Unification migration report

Date: 2026-11-28 · Repository: `Obiorachibuike/SEOFlOW` · Status: implementation complete (pre-merge verification recorded below)

This report answers: what was retained, merged, changed and retired — and what migration (if any) was required. Background and evidence: [deployment audit](DEPLOYMENT-AUDIT.md).

## 1. What the two deployments actually were

One codebase, two Vercel production projects on the same commit:

- `seoflow` (`seoflow-rose.vercel.app`) — full auth/URL/encryption configuration; no AWS. **Selected as canonical.**
- `seo-fl-ow` (`seo-fl-ow.vercel.app`) — an inert Vercel AWS integration (`AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_RESOURCE_ARN`, `AWS_ROLE_ARN`, `S3_BUCKET_NAME`); auth unconfigured at runtime (fails closed). No separate source, schema, or feature set existed in it.

There was no second implementation to port. Deployment B's only unique contribution was its **provisioned AWS account/role/bucket**, which this change makes consumable by the application.

## 2. Retained (deployment A / shared codebase — unchanged in behavior)

- Better Auth (single authentication authority), Drizzle ORM, PostgreSQL via bounded `pg` pool with `sslmode`-honouring TLS.
- Email/password + verification + reset, optional Google sign-in; workspaces, roles, invitations; projects; robots-aware bounded crawls with pg-boss worker; SSE progress.
- AI task routing, Google Search Console, DataForSEO, DataForSEO cost recording, Stripe/Paystack billing with signed idempotent webhooks.
- Private report artifacts: server-side authorized reads, byte-size + SHA-256 verification, fixed content types, 50 MB cap, database index, no public URLs.
- Structured JSON logging with redaction; reference-ID error taxonomy; health endpoints; diagnostics endpoints.
- All existing tests (146) and the Drizzle migration history (`0000`–`0003`) — **no schema changes**.

## 3. Merged / brought in from deployment B

- The Vercel AWS integration becomes usable: `AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_RESOURCE_ARN`, `AWS_ROLE_ARN`, `S3_BUCKET_NAME` are now read by shared server code.
- Credentials are role-based: Vercel injects `VERCEL_OIDC_TOKEN`; the app exchanges it via STS `AssumeRoleWithWebIdentity` (1 h, cached to 5 min before expiry). No keys stored. Static `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` remain supported for S3-compatible stores/MinIO.
- Same integration-driven path now powers: (a) private S3 report archives, (b) Amazon SES account email (`EMAIL_PROVIDER=ses`), (c) opt-in CloudWatch operational metrics (`AWS_CLOUDWATCH_METRICS=true`).

## 4. Changed (additive, backward-compatible)

- Error taxonomy: new codes `AWS_CONFIGURATION_ERROR`, `AWS_ACCESS_DENIED`, `AWS_SERVICE_UNAVAILABLE`, `S3_UPLOAD_ERROR`, `S3_DOWNLOAD_ERROR`, `SES_DELIVERY_ERROR` (+ public messages, code metadata, `storage`/`email` categories). No existing code removed or renumbered.
- Object storage: shared credential resolution; integration config fails closed (`STORAGE_CONFIGURATION_INVALID`) instead of silently disabling archival; provider failures classify into `S3_*` codes with preserved reference IDs.
- Email delivery: provider selection (`EMAIL_PROVIDER`); SMTP default unchanged; SES opt-in; no silent cross-provider fallback; auth email wrapper preserves provider reference IDs.
- HTTP layer: `jsonError` includes sanitized `AppError.details` when present.
- `next.config.mjs`: optional host-based 308 redirect (`REDIRECT_SECONDARY_HOST`, `CANONICAL_APP_ORIGIN`) to transition the duplicate deployment. Inactive unless both are set (canonical project leaves them unset).
- CI: GitHub Actions workflow (typecheck, lint, unit tests, production build) on PRs and `main`.

## 5. Retired

- Nothing in the application code was deleted or stubbed. All existing screens, APIs and workflows are untouched.
- The `seo-fl-ow` Vercel project is **not** deleted yet; retirement sequence is in `docs/DEPLOYMENT.md` (redirect → stability window → delete/pause). The failing pre-`#2` deployments (`e3949ec`, `f2e92fc`) are historical.
- Not implemented (out of scope, with reason): Cognito/Amplify migration (no such provider exists here), RDS move (no requirement), presigned public URLs (weaker than authorized streamed reads), second auth system (explicitly rejected).

## 6. User identity and data migration

- **Required: no.** Both deployments are the same Better Auth system over the same schema; there is no divergent identity store to reconcile. Deployment B could not complete a sign-up at runtime (auth fails closed in production without the secret/URL/encryption env), so it holds no usable divergent accounts.
- **Password compatibility: unchanged.** Better Auth password hashing is untouched; no hash format conversion was performed or implied. Existing sessions continue to validate against the same tables.
- **Verification performed instead of migration:** single Better Auth authority preserved end-to-end (`src/auth/index.ts`); the `/api/auth/*` route and health diagnostics behavior is covered by existing tests; production verification is the post-deploy smoke check (`/api/health`, sign-in, `/api/health/auth`) listed in `docs/DEPLOYMENT.md`.
- **Data backups:** no production database writes were performed by this change. Before the operator runs any production step, take a `pg_dump` (or provider backup) and a bucket listing/snapshot as a revert point; nothing in this PR performs them since no data changes ship.

## 7. Verification evidence (this branch)

- `npm run typecheck` — clean.
- `npm run lint` — clean (0 errors, 0 warnings).
- `npm run test` — 180/180 passing (23 files), including new mocked-SDK STS/SES/CloudWatch suites and all pre-existing tests.
- `npm run build` — succeeds; all routes compile.
- E2E (Playwright public-page smoke) — not run in this workspace (requires Chromium + configured app/DB); unchanged from before this change.
- Live AWS operations (SES send, S3 put/get, CloudWatch PutMetricData) — **not executed**; no AWS credentials exist in this workspace. Automated tests mock the SDKs. Real-account validation is a documented deployment-gate step.
- Vercel production deployment of the merged result — pending merge; evidence is recorded in the final report and was not claimed without verification.

## 8. Rollback

- Code: revert the unification commit/PR; Drizzle history untouched, so no migration rollback exists or is needed.
- Configuration: canonical project keeps its original env vars; removing the added AWS variables returns the app to its pre-merge behavior (archival off, SMTP unchanged). The `REDIRECT_*` variables can be unset at any time to restore the duplicate deployment as a standby.
- Database: restore from backup only if an external incident unrelated to this change occurs; this change never touches data.
