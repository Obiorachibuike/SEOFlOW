# Deployment and operations

## Process topology

Deploy one **Next.js web service** and at least one **long-lived Node.js worker** as separate services. Both connect to the same PostgreSQL database. The worker must not be placed in a short-lived serverless function: it consumes pg-boss jobs and may process a crawl for minutes. The web app may be deployed to a managed Next.js host (including Vercel), but run `npm run worker` on a persistent Node/container platform.

```text
Browser ──HTTPS──> Next.js web ──> PostgreSQL + pg-boss tables
                          │                    ▲
                          ├── provider APIs     │
                          └── private S3        │
Persistent Node worker ─────────────────────────┘
```

Scale web and worker independently. pg-boss coordinates queue claiming through PostgreSQL; do not run crawls inline in a request handler. The local `docker-compose.yml` provisions only PostgreSQL for development.

## Release sequence

1. Provision PostgreSQL with TLS, backups, monitoring, network access for web/worker and a role that can create/use the pg-boss schema. Create a separate database per environment.
2. Configure deployment secrets (see `.env.example` and [integrations](INTEGRATIONS.md)). The web and worker need `DATABASE_URL`; the web needs auth and feature-provider secrets. The worker needs crawl controls and database access. Do not put any secret in a `NEXT_PUBLIC_*` variable.
3. Build and run checks in CI: `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
4. Generate and inspect migrations in development. In the release job, run `npm run db:migrate` once against the target database before deploying dependent application code. Do not run migrations concurrently from every web instance.
5. Run `npm run db:seed` after migrations. For initial administrator setup, create and verify the account, set `ADMIN_EMAIL`, re-run seed, confirm access to `/dashboard/admin`, then remove the bootstrap variable.
6. Deploy the web app with `npm run start` on the platform's assigned port. Deploy a separate persistent worker with `npm run worker`. Ensure the worker has graceful SIGTERM time to drain its active job.
7. Smoke-test `GET /api/health`, sign-in/email delivery, workspace isolation, one small robots-allowed crawl, SSE progress, report download and provider-specific staging flows.

Use the same `BETTER_AUTH_SECRET`, `SECRETS_ENCRYPTION_KEY` and canonical public origin across web instances in an environment. Configure `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` to the externally visible HTTPS origin; set the Search Console callback URI to the exact public callback URL. Configure the host to accept the correct forwarded HTTPS scheme so secure cookies and provider callback URLs remain valid.

## Platform considerations

- **Serverless web hosts:** keep the web API request duration/body limits and SSE/proxy idle timeout compatible with your host. Crawls are not serverless tasks; only request enqueueing and status delivery occur in the web app.
- **Persistent worker:** restart on failure, retain logs, allow SIGTERM/SIGINT, alert on crash loops, queue backlog and stale `running` crawls. A single worker is sufficient for basic testing; production concurrency and database connection capacity must be load-tested before scaling.
- **Database:** pg-boss uses PostgreSQL. Size connection limits for web instances, workers and operator jobs. Monitor migrations, transaction latency, table growth (`rate_limit_buckets`, crawl pages/issues and usage records), disk/backup health and restore tests.
- **Outbound network:** the web and worker need HTTPS egress to only the enabled providers and crawled public origins. Enforce egress controls in addition to application SSRF checks. Configure robots-aware crawl limits and upstream proxy timeouts.
- **Object storage:** use a private bucket, narrow write/read/delete permissions for the app identity, HTTPS, provider-side encryption and lifecycle/retention policy. Object archival is optional; when enabled, generated PDF/CSV downloads also create database-indexed private artifacts. The artifact read path checks the expected byte size and SHA-256. Keep object and database retention policies aligned.
- **Observability:** `/api/health` checks only database reachability. Monitor web error rate/latency and worker liveness separately. Alert on `STORAGE_*`, `SEO_DATA_PROVIDER_*`, `GOOGLE_*`, billing webhook failures and pg-boss retry/failure counts without logging secrets or raw user documents.

## Backups, upgrades and recovery

Use managed encrypted backups or tested `pg_dump`/restore procedures; protect the secret-encryption key separately. Test restoring both the database and referenced object storage. A database restore without the correct encryption key loses the ability to decrypt provider tokens. A restored report-artifact row whose object is absent will fail closed on download.

Deploy schema changes with expand/contract migrations when rolling out multiple web versions. Keep migrations forward-only unless a reviewed rollback is explicitly authored; restoring a backup is safer than guessing a reverse SQL operation. Never reset or regenerate production schema from ORM state.
