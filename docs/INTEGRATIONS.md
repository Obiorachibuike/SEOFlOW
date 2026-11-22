# Provider and external-service setup

External services are optional until their feature is enabled. Keep secrets in the deployment secret manager and server runtime only. After each configuration change, test against a provider's staging/test account before exposing the feature to customers.

## Email and account auth

- Core auth needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`; use the same public HTTPS origin for both URLs in production.
- Email/password registration requires verification. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and a valid `SMTP_FROM` to send verification, password-reset and invitation mail. Without SMTP, links are only printed to server logs in non-production. Production mail sending fails closed when SMTP is missing.
- Optional Google sign-in requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Register the Better Auth callback URL at `<BETTER_AUTH_URL>/api/auth/callback/google` with Google Cloud.

## Google Search Console

1. Create a Google Cloud OAuth client and enable the Search Console API.
2. Set `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`, `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` and `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI`.
3. Register that exact redirect URI in the OAuth client. The default callback is `<NEXT_PUBLIC_APP_URL>/api/google/search-console/callback`.
4. Connect Google from an authorized project, then select a property whose domain matches that project.

The integration requests Search Console access for the connected user; its access/refresh tokens are encrypted with `SECRETS_ENCRYPTION_KEY`. OAuth credentials for Google sign-in are separate from Search Console OAuth credentials. Clicks, impressions, CTR and position are Google observations and are not keyword-volume estimates. Google quota/reauthorization errors are surfaced to the user.

## AI providers and Agnes AI

1. Sign in as a platform super-admin and open **Dashboard → Admin → AI**.
2. Add a provider using a supported adapter (`agnes-openai-compatible`, `openai-compatible` or `huggingface-chat-compatible`), its HTTPS base URL, display name and API key.
3. Add the provider's exact model ID, display name, capabilities and optional price metadata; enable the provider/model and configure task assignment/routing.
4. Use the provider test action, then test each assigned workflow with non-sensitive content before rollout.

The gateway checks the `agnes` provider slug first for the default route, then uses enabled configured task-routing candidates. The application deliberately does not hardcode a model identifier. Provider credentials are encrypted at rest, but prompt content and selected evidence are sent to that provider. Review its data-processing terms. AI text is a proposal for user review; no content is silently published.

## DataForSEO

Set both `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`. In the project, set a two-letter ISO target country (and optional language), then explicitly trigger refresh. Implemented live operations are:

- DataForSEO Labs Google keyword overview: provider-estimated search volume, difficulty and CPC for tracked terms.
- Backlinks summary: provider-reported backlink/referring-domain counts and rank summary.
- DataForSEO Labs Google competitors domain: provider-reported organic-overlap observations.

Refresh routes require project management permission and use a user-scoped PostgreSQL rate limit (five requests per minute across these SEO-data refreshes). The provider task ID and returned provider cost are stored when supplied. The service credentials are deployment secrets; they are not stored per workspace. Configure an account budget/alerts with DataForSEO, as provider costs can occur even when a response contains no usable rows. A credentialed live contract test has not been performed by this repository's automated suite.

## Subscription payments

Only one payment provider can be active per deployment: set `PAYMENT_PROVIDER=stripe` or `PAYMENT_PROVIDER=paystack`. Leave it blank to disable checkout. Configure matching monthly price IDs/codes for every paid plan in **Dashboard → Admin → Plans**. At checkout the app checks that provider-reported amount, currency and monthly interval match the plan; a mismatched/inactive provider price is rejected.

### Stripe

- Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from the same Stripe environment (test keys for staging, live keys only after validation).
- Register `POST https://<public-host>/api/webhooks/stripe` in Stripe and configure events handled by the app: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_succeeded`, and `invoice.payment_failed`.
- Store each paid plan's active monthly Stripe Price ID in the Admin Plans page.

### Paystack

- Set `PAYSTACK_SECRET_KEY`; optionally set `PAYSTACK_WEBHOOK_SECRET` if your webhook signature secret differs from the API secret (the API secret is the default verification key).
- Register `POST https://<public-host>/api/webhooks/paystack` in Paystack and validate charge/subscription lifecycle events in test mode, including `charge.success`, `subscription.create`, `subscription.disable`, `subscription.not_renew`, `subscription.enable` and `invoice.payment_failed`.
- Store each paid plan's monthly Paystack plan code in the Admin Plans page.

Provider webhooks—not checkout return URLs—activate or update subscriptions. Verify signatures, duplicate delivery, delayed/out-of-order events, payment failure, cancellation and renewal in a staging workspace. `NEXT_PUBLIC_APP_URL` must be HTTPS for production billing.

## S3-compatible report archives

Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together. `S3_ENDPOINT` is optional for AWS S3; set it to an HTTPS origin for a compatible service (development may use local HTTP). `S3_FORCE_PATH_STYLE=true` is the usual setting for MinIO and many custom endpoints; custom endpoints default to path-style. Production custom endpoints must use HTTPS.

Create a private bucket and grant the app only the operations needed to put, get and delete report objects. Keep public access blocked, require TLS, enable provider-side encryption at rest, and establish an intentional retention policy. SEOFlow stores a database artifact index and serves downloads through the authorized application route, never a public bucket URL. Report data may include project URLs and technical findings. If storage variables are all blank, no S3 request is made and PDF/CSV reports are streamed without persistent object archival.

## Secrets and activation

`SECRETS_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes. Generate it once with `openssl rand -base64 32`, store it in a durable secret manager, and back it up separately from the database. Changing the key without first decrypting/re-encrypting saved values makes existing provider credentials unusable. Never paste live secrets into issue trackers, logs, browser dev tools, or this repository.
