# Error codes and reference-ID troubleshooting

## Why reference IDs exist

Every unexpected failure inside SEOFlow is assigned a **reference ID** (a UUID). The same ID appears:

1. In the client-facing error payload (`referenceId`), which the UI shows to the user;
2. In the structured JSON log line(s) for that failure (`referenceId` field). One ID always maps to one failure — a provider-side line (e.g. storage) and the HTTP-layer line share the same ID;
3. In no response that could leak internals — stack traces, SQL, connection strings and credentials are never sent to the browser.

Reference IDs are generated once at the point of failure and preserved when an error is rethrown or re-wrapped, so one ID always maps to one failure.

If a user reports `Reference ID: 108e9014-5cf3-4202-9b5b-9e31d0a9d620`, search the server logs for that string to find the full (sanitized) diagnostic record: code, category, operation, SQLSTATE (when available), latency and retryability.

## Public error payload shapes

**Authentication route** (`POST /api/auth/*`) unexpected failure:

```json
{
  "code": "AUTH_DATABASE_ERROR",
  "referenceId": "108e9014-5cf3-4202-9b5b-9e31d0a9d620",
  "message": "We couldn't connect to your account database. Please try again shortly.",
  "retryable": true
}
```

**Health endpoint** (`GET /api/health`) failure:

```json
{
  "status": "error",
  "code": "DATABASE_CONNECTION_ERROR",
  "referenceId": "…",
  "message": "We couldn't connect to your account database. Please try again shortly."
}
```

Expected Better Auth API errors (wrong password, unverified email, rate limited) are returned by Better Auth itself with its normal status codes and `INVALID_EMAIL_OR_PASSWORD`-style codes, not wrapped in a reference ID.

## Error code reference

| Code | Category | HTTP | Retryable | Meaning / first action |
| --- | --- | --- | --- | --- |
| `DATABASE_CONFIGURATION_ERROR` | configuration | 500 | no | `DATABASE_URL` missing/invalid, or database does not exist. Check deployment env, not the code. |
| `DATABASE_CONNECTION_ERROR` | connection | 503 | yes | Database unreachable/refused (SQLSTATE 08xxx/57P0x, ECONNREFUSED/ENOTFOUND). Check host, network ACLs/allowlist, TLS mode. |
| `DATABASE_CONNECTION_TIMEOUT` | timeout | 503 | yes | Connect/query timed out. Check provider status, pool sizing, slow queries. |
| `DATABASE_POOL_EXHAUSTED` | pool | 503 | yes | Pool saturated (SQLSTATE 53300/53400). Check `PG_POOL_MAX` and provider connection limits. |
| `DATABASE_QUERY_ERROR` | query | 500 | no | Statement failed for a non-classified reason. Read the log's `pgSqlState`. |
| `DATABASE_PERMISSION_ERROR` | permission | 500 | no | Role lacks privileges / bad credentials (28000, 28P01, 42501). Check DB role grants. |
| `DATABASE_SCHEMA_ERROR` | schema | 500 | no | Required tables/columns missing or mismatched (42P01, 42703, 3F000). **Run `npm run db:migrate`.** |
| `DATABASE_MIGRATION_ERROR` | schema | 500 | no | Migration run failed or was inconsistent. See release procedure in DEPLOYMENT. |
| `AUTH_CONFIGURATION_ERROR` | configuration | 500 | no | Auth service misconfigured (e.g. `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`). |
| `AUTH_DATABASE_ERROR` | authentication | 500 | yes | The authentication path hit a database failure. Distinguish via the log's `cause` chain. |
| `AUTH_SIGNUP_FAILED` | authentication | 500 | yes | Signup failed unexpectedly. |
| `AUTH_LOGIN_FAILED` | authentication | 500 | yes | Sign-in failed unexpectedly. |
| `AUTH_SESSION_ERROR` | authentication | 500 | yes | Session create/retrieve/validate failed. |
| `AUTH_VERIFICATION_ERROR` | authentication | 500 | yes | Email verification flow failed. |
| `AUTH_PASSWORD_RESET_ERROR` | authentication | 500 | yes | Password reset flow failed. |
| `AUTH_OAUTH_ERROR` | authentication | 500 | yes | Google OAuth or its callback failed. Check client id/secret and redirect URI. |
| `AUTH_INVALID_CREDENTIALS` | authentication | 401 | no | Email/password did not match (expected failure, no stack trace). |
| `AUTH_EMAIL_NOT_VERIFIED` | authentication | 403 | no | Email/password sign-in attempted before verification. |
| `AUTH_RATE_LIMITED` | authentication | 429 | yes | Too many attempts. |
| `EMAIL_DELIVERY_ERROR` | authentication | 500 | yes | Verification/reset email could not be sent. Signup still succeeds; user can request a new link. Check `EMAIL_PROVIDER` and the SMTP/SES configuration. |
| `AWS_CONFIGURATION_ERROR` | configuration | 500 | no | AWS integration is misconfigured (region, bucket, role ARN, account id, sender identity). Check `details.reason` in the server log. |
| `AWS_ACCESS_DENIED` | permission | 502 | no | STS AssumeRoleWithWebIdentity or an AWS API call rejected the credentials. Check the role trust policy, the OIDC provider and bucket/SES IAM permissions. |
| `AWS_SERVICE_UNAVAILABLE` | connection | 503 | yes | AWS throttled, timed out or 5xx-failed. Retry with backoff; check the AWS service health dashboard. |
| `S3_UPLOAD_ERROR` | storage | 502 | yes | Report archive write failed (the export itself succeeded). Check storage configuration and bucket policy. |
| `S3_DOWNLOAD_ERROR` | storage | 502 | yes | Archived report could not be read or failed the SHA-256/size integrity check. |
| `SES_DELIVERY_ERROR` | email | 502 | yes | SES rejected or failed to send. Check the verified sender identity, DKIM, IAM SES permissions and account sending limits. |
| `INTERNAL_ERROR` | internal | 500 | no | Unclassified. Read the full log line for the reference ID. |

## Troubleshooting with a reference ID

1. **Locate the log line.** Search runtime logs for the reference ID. On Vercel: Project → Logs (Runtime) and filter by `AUTH_` or `DATABASE_` events; locally, `npm run dev` prints one JSON object per line.
2. **Read the classification, not the stack.** Each line carries `code`, `category`, `operation`, `pgSqlState` (when the failure came from PostgreSQL), `retryable` and `latencyMs`. The `cause` chain preserves the original driver error server-side — never copy it into chat tickets, issues or support emails if it embeds infrastructure details.
3. **Map the code.** Use the table above. `DATABASE_SCHEMA_ERROR` → apply migrations. `DATABASE_CONNECTION_*` → network/TLS/provider. `DATABASE_POOL_EXHAUSTED` → sizing. `AUTH_CONFIGURATION_ERROR` → env. `EMAIL_DELIVERY_ERROR` → email provider configuration (`EMAIL_PROVIDER`). `AWS_CONFIGURATION_ERROR` → AWS env. `AWS_ACCESS_DENIED` → OIDC role trust policy / IAM permissions. `AWS_SERVICE_UNAVAILABLE` → retry/backoff and provider health. `S3_*` → storage configuration/bucket. `SES_DELIVERY_ERROR` → sender identity/DKIM/IAM.
4. **Verify with health endpoints.** `GET /api/health` (public, minimal) confirms liveness and database reachability. `GET /api/health/database` and `GET /api/health/auth` (see below) report exactly which dependency fails, authorized with either `Authorization: Bearer <HEALTH_DIAGNOSTICS_KEY>` or a super-admin session. Unauthorized callers receive the same `404` as an unknown route.
5. **Do not retry non-retryable codes** in loops; `retryable: false` means the same request will fail the same way until configuration or schema changes.

## Health endpoints

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /api/health` | public | `{status:"ok", service:"SEOFlow", timestamp}` or 503 `{status:"error", code, referenceId, message}` |
| `GET /api/health/database` | diagnostics key or super-admin | Environment presence booleans, `SELECT 1` latency, auth-schema check (missing tables/columns by name), pool stats. 503 when unhealthy. |
| `GET /api/health/auth` | diagnostics key or super-admin | Secret presence/strength (boolean only), base-URL validity, Google OAuth/SMTP presence, auth-schema check. 503 when unhealthy. |

Neither detailed endpoint returns secret values, connection strings, hosts or SQL — booleans, counts and codes only. Without `HEALTH_DIAGNOSTICS_KEY` and a super-admin session they answer `404 {"status":"error","code":"NOT_FOUND","message":"Not found."}`.

## Structured log format

One JSON object per line: `severity` (DEBUG/INFO/WARN/ERROR/FATAL), `timestamp`, `service`, `environment`, `event`, plus `code`, `referenceId`, `operation`, `method`, `path`, `requestId`, `latencyMs`, `pgSqlState`, `retryable` and sanitized error details (`errorName`, `errorMessage` truncated and redacted). Passwords, cookies, authorization headers, tokens, connection strings and email addresses are redacted by key name and by value pattern.
