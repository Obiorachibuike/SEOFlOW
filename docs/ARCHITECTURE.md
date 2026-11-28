# Architecture and data flows

## Runtime boundaries

- **Web:** Next.js App Router server components, client controls and Route Handlers. Pages may read PostgreSQL on the server; browser controls call same-origin API routes.
- **Database:** PostgreSQL is the system of record. Drizzle models Better Auth accounts/sessions, organizations and memberships, projects, crawls and findings, AI configuration/usage, keywords/observations, billing, rate limits and report archives.
- **Worker:** `src/worker/index.ts` runs as a separate Node process. `pg-boss` stores jobs in PostgreSQL; workers claim crawl jobs and persist progress, pages, links, issues and reports. Run at least one worker in every environment that accepts crawl jobs. The web process does not perform the long crawl inline.
- **External services:** Better Auth email, optional Google OAuth/Search Console, configurable AI HTTP providers, DataForSEO, Stripe/Paystack and optional private S3 storage are called through server-side adapters. Browser requests do not contain provider credentials.

The public health endpoint (`GET /api/health`) reports minimal liveness and database reachability; it does not prove that the worker or any third-party provider is healthy. Detailed diagnostics live behind access control: `GET /api/health/database` and `GET /api/health/auth` require a `HEALTH_DIAGNOSTICS_KEY` bearer token or a super-admin session, return only booleans/counts/codes, and answer 404 otherwise. Authentication and database failures are classified into stable codes with a per-failure reference ID that appears in both the client payload and exactly one structured log line; see [errors](ERRORS.md).

## Tenant and authorization model

`organizations` are workspaces. `organization_members` links a user and an organization with one of `owner`, `admin`, `seo_manager`, `editor` or `viewer`. `projects` belong to exactly one workspace. Project APIs resolve the project and the caller's membership before reading or mutating its data; query conditions also use project/workspace IDs. Billing, invitations, administration and provider-cost usage have separate server-side authorization rules.

Client-side capability flags only hide/disable controls; they are not the authorization boundary. Route handlers must call `requireApiUser`, `requireProject`, membership/role checks, or `requireAdmin` before protected reads and writes. New endpoints must use the same pattern. See [security](SECURITY.md).

## Important data paths

1. **Authentication:** Better Auth stores users, sessions, accounts and verification tokens in PostgreSQL. The auth route wrapper (`src/app/api/auth/[...all]/route.ts`) generates a request ID, returns expected Better Auth API responses unchanged, and converts unexpected failures into classified payloads (`AUTH_DATABASE_ERROR` with a reference ID when the database path fails). The database layer (`src/db/index.ts`) lazily creates one shared `pg` pool per runtime with bounded size, timeouts, TLS resolved from the connection string's `sslmode` (no silent `rejectUnauthorized: false`) and classified errors (configuration/connection/timeout/pool/query/schema/permission). Password reset and email verification use the configured email adapter — SMTP by default, or Amazon SES when `EMAIL_PROVIDER=ses` (with development log output when no provider is configured outside production). Session cookies are HTTP-only, SameSite=Lax and secure in production.
2. **Project creation and crawl:** a workspace role creates a project after URL validation. A crawl request checks the plan/page ceiling and duplicate-run state, writes a queued crawl, and enqueues a pg-boss job. The worker fetches a bounded number of pages using the SSRF-safe HTTP layer, applies robots policy, persists page/link records and deterministic versioned issues, then writes a report. Progress is stored on the crawl row and exposed to authorized users using an SSE response that polls persisted state.
3. **AI:** the gateway selects enabled provider/model candidates by task assignment, tries eligible configured routes, decrypts API credentials only server-side, applies timeouts and validates response shape with Zod. Evidence is selected from the authorized project/crawl and included as context; output remains a proposal. Model IDs and endpoint URLs are configured by a super-admin, not hardcoded in task code.
4. **Search data:** Google Search Console uses per-project OAuth state and encrypted credentials. Clicks, impressions and average position are observations from Google's API. DataForSEO keyword volume/difficulty/CPC and backlink/competitor summaries are provider estimates/observations; provider task IDs and returned costs are persisted in `seo_data_usage`. All such reads are scoped to an authorized project.
5. **Billing:** the workspace owner/admin starts a checkout. A database checkout-session reservation prevents multiple pending checkouts per workspace and keeps provider prices tied to configured plan price/currency. The browser return URL does not activate a subscription; signed, idempotent webhooks update subscription state. Webhooks are bounded and use provider signatures.
6. **Reports:** exports are generated from persisted audit records. Optional archival to private S3 (role-based Vercel AWS integration or static S3-compatible credentials) stores private objects and an index row; the object key is never sent to the browser. Retrieval requires project membership and verifies the stored size and SHA-256 checksum before serving a fixed content type.

## Schema and migrations

`src/db/schema.ts` is the schema source. Checked-in SQL and snapshots under `drizzle/` are the deployment history. For a schema change:

1. Change the schema and add/update tests.
2. Run `npm run db:generate` against the checked-in migration snapshots.
3. Review generated SQL and snapshots; confirm indexes, constraints, defaults, foreign keys and destructive changes.
4. Apply to a disposable/staging PostgreSQL database with `npm run db:migrate` and verify the app/worker.
5. Deploy the migration as a release step before code that depends on it.

Do not rely on application startup to mutate schema. `npm run db:seed` is idempotent for plan rows and can optionally grant `ADMIN_EMAIL` a super-admin role after that user exists.

## Extension guidance

- Add provider integrations in `src/lib/*` server-only modules, validate external responses with Zod, bound body/time sizes, and return sanitized errors. Persist data source/provenance rather than mixing estimates with observations.
- Put long-running or retryable work in pg-boss; make handlers idempotent and persist terminal states.
- Any new protected table or API must include tenant-key conditions and server-side membership checks. Add tests for cross-tenant denial.
- Keep object-storage keys private and opaque; do not create public ACLs or hand out permanent presigned URLs. Configure external retention and encryption policies with the provider.
