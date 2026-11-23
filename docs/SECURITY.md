# Security model and operational safeguards

SEOFlow handles account credentials, private workspace data, third-party API secrets and provider billing events. This document describes the application safeguards and what the operator still needs to provide. It is not a penetration-test report or certification.

## Identity, roles and tenant isolation

- Better Auth stores passwords through its supported password flow and uses database-backed sessions. Configure `BETTER_AUTH_SECRET` to a high-entropy value, use HTTPS in production and keep the app's public URL exact.
- HTTP-only, SameSite=Lax cookies are used; production cookies are secure. Email verification is required for email/password registration. Configure SMTP before enabling sign-up in production.
- Organization membership is checked server-side for project, content, keyword, analytics, report and billing operations. Admin routes perform a database-backed platform-role check. UI role flags are not trusted by APIs.
- New endpoints need authorization before database reads as well as writes. Avoid queries by user-supplied IDs alone: include the authorized project/workspace scope in query conditions. Add cross-tenant denial tests for each new resource.
- Bootstrap a first super-admin with `ADMIN_EMAIL` only after the account exists; remove that bootstrap variable after the role is granted. Protect administrator accounts with strong unique passwords and any identity-provider MFA available to the operator.

## Secret storage and data handling

- AI provider credentials, Search Console refresh/access tokens and Paystack subscription action tokens are encrypted at rest in the database using AES-256-GCM and `SECRETS_ENCRYPTION_KEY` (base64-encoded 32-byte key). Keep this key stable and backed up separately from database backups; losing it makes encrypted provider credentials unrecoverable. Key rotation requires a deliberate re-encryption procedure; changing the key alone is not a rotation.
- Provider credentials and payment secrets are used server-side only. Never put them in `NEXT_PUBLIC_*`, client bundles, logs, URLs, issue reports or support tickets. Do not return ciphertext or decrypted values from admin APIs.
- AI prompts may send selected project evidence and user-supplied content to the configured AI provider. Configure providers only after reviewing their data retention and processing terms. AI responses are untrusted proposals, schema-validated and not executed against a site.
- Search Console values are observations from Google. DataForSEO values are provider estimates or provider-reported observations. Do not present these as interchangeable or as guaranteed facts.
- Optional report archives use private S3-compatible objects, server-side credentials, fixed content types and checksum verification. Set bucket public access blocking, TLS, least-privilege IAM, provider-side encryption at rest and an intentional retention policy. The app does not issue public URLs. Object deletion/retention policies must be coordinated with the database index so an expired object is not shown as downloadable.

## Crawl and outbound-request safety

- Crawler destinations are parsed and constrained to supported HTTP(S) URLs and safe ports, resolved to public IP addresses, and DNS-pinned for the actual connection. Private, loopback, link-local and otherwise unsafe resolved addresses are rejected. Redirects are revalidated rather than blindly followed.
- Requests have timeouts and response-size/page ceilings. Robots directives and crawl delays are respected, and the configured user agent is sent. The crawler does not execute page JavaScript.
- Crawler limits are application controls, not proof of site ownership. In a public deployment, add abuse monitoring and consider a site-verification step, domain allowlist or per-workspace crawl budget before letting arbitrary users submit origins.
- Keep the crawler's egress restricted at the network layer too. Application SSRF checks complement, but do not replace, outbound firewall/DNS policy and monitoring.

## API, payments and AI

- Request bodies and external provider responses are size-bounded and validated with Zod. Rate limits are persisted in PostgreSQL so they are shared across web instances. This is not a replacement for edge/WAF limits on unauthenticated traffic, credential stuffing or volumetric attacks.
- Stripe/Paystack webhook routes consume bounded raw bodies, verify provider signatures and deduplicate provider event IDs before applying state changes. Subscription activation comes from webhooks, not from a browser redirect. Use HTTPS webhook endpoints and configure provider-side retry/alerting.
- Provider calls use configured endpoints and timeouts; errors returned to users are sanitized. Treat upstream HTML, structured data and AI output as untrusted. Do not render provider-supplied markup as HTML.
- Keep checkout pricing and currencies synchronized with dashboard plans and provider price IDs/codes. Test successful, failed, duplicate and out-of-order webhook deliveries in provider test mode before launch.

## Production checklist

1. Set unique high-entropy `BETTER_AUTH_SECRET` and stable `SECRETS_ENCRYPTION_KEY`; store them in a secret manager.
2. Use HTTPS, correct trusted origins, secure cookies, a restrictive CSP/security-header policy at the deployment edge, and no wildcard CORS.
3. Deploy PostgreSQL with TLS/network controls, least-privilege credentials, encrypted backups and tested restore procedures. Apply reviewed migrations before app rollout.
4. Restrict worker egress and access to production secrets. Monitor queue depth, retries, crawl failures, provider failures and DB pool saturation.
5. Add edge request/body limits, bot controls and alerting; the DB rate limiter is application-level only.
6. Run staging credential tests, cross-tenant authorization tests, dependency review, secret scanning and an independent security assessment before production traffic.
