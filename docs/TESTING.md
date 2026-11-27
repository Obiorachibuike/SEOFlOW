# Tests and verification

## Automated checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Vitest tests cover deterministic SEO analysis, crawl parser/security utilities, JSON body limits, AI response schemas, secret encryption, payment primitives, DataForSEO response/normalization validation, S3 archive configuration behavior, PDF output, and project validation. Run focused tests with `npx vitest run src/lib/<module>/<name>.test.ts`.

Authentication and database coverage runs against in-process fakes and an embedded Postgres:

- `src/db/auth-integration.test.ts` boots **PGlite** (real PostgreSQL compiled to WASM), applies the checked-in migrations from `drizzle/`, and exercises Better Auth end to end: signup, verification email delivery and callback, blocked sign-in before verification, session-backed sign-in, wrong-password rejection, enumeration-safe duplicate registration, password reset through the emailed token, and signup against a database that was never migrated. No production or shared database is touched.
- `src/db/index.test.ts` covers pool configuration (missing/malformed `DATABASE_URL`, non-PostgreSQL protocols, TLS resolution incl. `sslmode` passthrough and the `DATABASE_SSL` override, pool sizing clamps) and health/schema checks with a mocked driver.
- `src/app/api/auth/[...all]/route.test.ts` verifies the auth route wrapper: expected 4xx responses pass through untouched; unexpected/database failures become `AUTH_DATABASE_ERROR` (or the classified database code) with a reference ID; no internals reach the client.
- `src/app/api/health/health.test.ts` covers the public and restricted health endpoints (404-unauthorized behavior, super-admin access, 503 with reference ID, missing-table reporting).
- `src/lib/errors.test.ts`, `src/lib/logger.test.ts` cover classification, reference-ID stability across re-wraps, log redaction and structured output.
- `src/components/auth/auth-form.test.tsx` (jsdom) covers loading termination, duplicate-submit prevention, invalid-email rejection, verification notices, reference-ID display on 5xx failures, sanitized network/server errors and Google sign-in failure paths.

The integration suite does not boot a real pg-boss worker, test all tenant authorization paths against a live database, or make paid provider requests. Run migrations and smoke-test web/worker interactions in a disposable PostgreSQL environment before rollout.

## Playwright E2E

`npm run test:e2e` starts the local Next.js dev server and runs the two public-page Chromium smoke tests in `tests/e2e/`. Install Chromium first:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

In a restricted network environment the browser download can fail; do not mark E2E as passed if Chromium is unavailable. These checked-in tests verify the home and sign-up pages, not authenticated project/database workflows.

## Provider and deployment tests still required

For each staging environment, add/run contract checks using test credentials for:

- Better Auth email delivery, verification, reset, cookie/origin and OAuth callbacks.
- PostgreSQL migrations and concurrent workspace plan/keyword/crawl limits; pg-boss retries, cancellation, graceful worker restart and SSE status.
- Project cross-tenant denial for every route, including report archive listing/download and provider refreshes.
- Search Console consent, property mismatch, token refresh, quota and revocation.
- AI provider selection/fallback, timeout, malformed/untrusted output and accurate usage/cost accounting.
- DataForSEO response shape, no-results/provider-error paths, rate limiting and recorded provider cost. Confirm request billing in a test provider account.
- Stripe/Paystack price mismatch rejection, signed and invalid signatures, duplicate/out-of-order events, cancellation and renewal.
- S3-compatible private writes/reads, object-size bounds, checksum mismatch, TLS, missing-object handling and retention.

Record the provider sandbox/account and observed result in deployment evidence; never claim real-provider support is operational based solely on successful compilation or unit tests.
