# Free Render deployment

Use **Render Free** for the Node.js web service and **Neon Free** for PostgreSQL. The Blueprint uses `plan: free`, declares no disk, and does not create a paid resource. Do not add billing information or upgrade either provider for this demo.

## Configuration

| Setting | Value |
| --- | --- |
| Source | GitHub repository, branch main |
| Compute | Render Free, one instance |
| Build | npm ci --omit=dev && npm run check |
| Start | node server.js |
| Health check | /healthz |
| Storage | External PostgreSQL through DATABASE_URL |
| Local development | SQLite when DATABASE_URL is blank |
| Automatic deploys | Off until deliberately enabled |

## Setup

1. Create a **Free** Neon project without adding a card or selecting a paid plan. Keep its pooled PostgreSQL connection URL private.
2. In Render, choose New → Blueprint and select this repository. Verify Free compute and no disk or paid database. If Render asks for a card, stop and inspect the selected configuration.
3. Supply DATABASE_URL, GEMINI_API_KEY, PAYPAL_CLIENT_ID, and PAYPAL_CLIENT_SECRET through Render's secret environment configuration. Use Gemini's available free quota and PayPal sandbox credentials. No paid model fallback or live PayPal endpoint is configured.
4. Render generates OWNER_SETUP_TOKEN and supplies RENDER_EXTERNAL_URL. The setup token is required only to create the first hosted account. It prevents an unrelated visitor from claiming the owner role.
5. Deploy and confirm /healthz returns {"status":"ok"}. The server verifies database connectivity before becoming ready.
6. Create the owner account yourself. Verify a project, saved analysis, proposal acceptance, and sandbox checkout. Verify saved data after a redeploy.

## Free-tier behavior

Render Free sleeps after 15 minutes of inactivity; waking can take about a minute. Do not add artificial keepalive traffic. Usage limits may suspend the service. Free web services do not preserve SQLite files across sleeps/restarts and cannot use disks, so FREE_HOSTING=true refuses to start without DATABASE_URL.

Neon Free has no trial expiration and requires no card. Compute and storage quotas apply: exhausting them can suspend compute or reject writes until capacity is available. Keep both accounts on Free plans. Render's own free Postgres is not used because it expires after 30 days.

## Local work and backups

Existing local accounts, sessions, projects, and payments remain in SQLite and are not automatically uploaded. A fresh Neon project starts empty. Transfer local data only through an explicitly authorized private migration, never through GitHub.

npm run db:backup backs up local SQLite only. It refuses to claim a PostgreSQL backup when DATABASE_URL is set. Cloud data needs a private PostgreSQL-native export or an available Neon snapshot. Keep recovery copies outside the running service.

The app shares one sandbox merchant. Verified PayPal webhooks, later refund/dispute reconciliation, email verification, and email-based password recovery are not implemented. PostgreSQL does not itself provide multi-instance payment coordination; this deployment stays single-instance.

## References

- [Render Free limits](https://render.com/docs/free)
- [Neon Free pricing](https://neon.com/pricing)
- [Neon usage limits](https://neon.com/docs/introduction/plans)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
