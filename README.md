# ScopePay

**Clear scope. Fair pay.** Turn a freelance client's “one more thing” into an explained scope addition and a PayPal sandbox payment.

ScopePay compares a client request with the original agreement, shows exact evidence, estimates implementation tasks and hours, and calculates a proposed price using the freelancer's hourly rate. The freelancer reviews the proposal before the client accepts and pays.

## What works

- Email/password accounts with salted scrypt password hashes, hashed session tokens, account isolation, and saved profiles/rates.
- Projects containing the original agreement and client details.
- Gemini analysis that separates included work, additional work, and requests needing clarification.
- Task-based effort estimates, assumptions, agreement evidence, and integer-cent price calculations.
- Saved reviews and proposals with client links, acceptance, and PayPal sandbox checkout.
- Server-side amount/currency verification, idempotent checkout/capture, and recovery after a lost payment response.
- Automatic payment confirmation and workspace updates while visible, with cross-tab notifications and focus recovery.
- A responsive interface with light/dark themes, a landing-page orbit illustration, project history, and account export.

## Run locally

Requires **Node.js 24**. The hosted PostgreSQL adapter uses node-postgres. There is no frontend build step.

```sh
# After cloning, open the repository folder.
cp .env.example .env
npm ci
npm start
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred. Copy the template only during first setup; never overwrite an already configured `.env`.

Open [http://localhost:4173](http://localhost:4173). Set `PORT=4175` to retain an existing preview port. `npm run dev` starts Node's watch mode.

## Configure providers

Edit `.env` privately:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side AI requests |
| `GEMINI_MODEL` | Model identifier; defaults to `gemini-3.5-flash-lite` |
| `PAYPAL_CLIENT_ID` | PayPal sandbox application client ID |
| `PAYPAL_CLIENT_SECRET` | Server-side PayPal sandbox secret |
| `PORT` | Local HTTP port; default 4173 |
| `DATABASE_URL` | Optional private PostgreSQL URL; leave blank for local SQLite |

Use sandbox credentials only. Restart after environment changes. The public PayPal client ID is provided to its browser SDK; secret values stay on the server. Missing AI credentials do not silently produce sample findings. A clearly labelled sample walkthrough is available separately.

## End-to-end demo

1. Create an account and set an hourly rate.
2. Add a project with its original agreement.
3. Paste a client request and run the AI review.
4. Inspect evidence, classifications, task estimates, assumptions, and calculated amounts.
5. Confirm the selected extra work and create a proposal.
6. Open the client link, review and accept the addition, then complete checkout using a separate sandbox buyer account.
7. Check the automatic receipt and updated workspace totals. “Approved” or “pending” does not mean paid; a matching completed capture is required.

## Data and security

SQLite stores users, sessions, projects, reviews, findings, tasks, proposals, items, payments, and activity. Local data defaults to `data/scopepay.db`. With `DATABASE_URL`, the hosted app uses normalized PostgreSQL over certificate-verified TLS; hosted accounts are not saved in disposable local files. Foreign keys, transactions, ownership checks, and migration tracking organize the records. Existing legacy records are preserved and linked to the first local owner account during upgrade.

`npm run db:backup` creates and integrity-checks an SQLite-native snapshot in the data directory's `backups` folder. Keep private copies outside the service for recovery.

The `.gitignore` excludes environment files, databases, backups, generated output, editor settings, and dependencies. Only the empty `.env.example` belongs in Git. Client proposal URLs contain access tokens: treat them as private links, not public documentation examples.

Local mode binds to loopback and checks the Host and request Origin. The free hosted configuration requires an HTTPS origin, private PostgreSQL `DATABASE_URL`, a strong first-owner setup token, and Secure/HttpOnly/SameSite cookies. See [Render preparation](docs/RENDER.md) for the deployment configuration and secret setup.

## Verify

```sh
npm run check
npm test
```

40 tests cover account isolation, password/session handling, saved rates, transactional records, restart persistence, hosted owner setup, host/origin checks, secure cookies, durable storage across release folders, verified backups, evidence/ambiguity, overlapping deliverables, money/task pricing, polling, concurrent checkout/capture, pending payments, cancellation, and lost-response recovery.

PostgreSQL storage tests use a local PostgreSQL engine (PGlite) to check rollback, account isolation, session revocation, and protection against stale updates undoing paid records. Payment failure tests use a mocked provider and do not move money. Passing tests does not certify a production payment system. GitHub Actions runs syntax checks and the test suite on Node.js 24 after source is pushed.

## Architecture and boundaries

Vanilla JavaScript modules, semantic HTML, custom CSS, Node.js HTTP, local SQLite, and a PostgreSQL adapter. AI runs through Gemini; payments run through PayPal's sandbox Orders API and browser SDK.

The free deployment is one Render Free web service with an external Neon Free PostgreSQL database. The Blueprint creates no paid compute and no disk. Free quotas can suspend service or reject writes; no paid fallback is configured. Render sleeps after inactivity, so the next visit can have a cold start. Local development can continue using SQLite. Multiple instances need durable locking and shared abuse controls. Status recovery polls existing orders; verified webhooks and reconciliation of later refunds/disputes are not implemented. The installation shares one sandbox merchant and provider configuration. Multi-merchant onboarding, live payments, escrow, email verification, email-based password recovery, and messaging integrations are outside the current prototype.

This is an independent hackathon prototype, not an official PayPal product. Sponsor deployment configuration is included, but this repository's existence alone does not mean it has been hosted or submitted.

## License

[MIT](LICENSE).

## References

- [PayPal sandbox checkout integration](https://developer.paypal.com/studio/checkout/standard/integrate)
- [PayPal REST authentication](https://developer.paypal.com/api/rest/authentication)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Render deployment preparation](docs/RENDER.md)
