# Render deployment preparation

The repository includes a Render Blueprint. Preparing this file does not create a Render service or deploy the application.

## Service design

| Setting | Configuration |
| --- | --- |
| Service | One Node.js web service serving the UI and API |
| Runtime | Node.js 24 |
| Build | `npm run check` |
| Start | `node server.js` |
| Health check | `/healthz` |
| Storage | SQLite at `/var/data/scopepay.db` |
| Persistent disk | 1 GB mounted at `/var/data` |
| Instances | One; disk-backed services cannot scale horizontally |
| Automatic deploy | Off until explicitly enabled |

The Blueprint selects paid compute because a free Render web service does not support a persistent disk. Review the current estimate and any available hackathon credits before applying it. A disk-backed deployment has a brief stop/start during deployment; it does not provide zero-downtime deploys.

## Deployment sequence

1. Push the reviewed source, including `render.yaml`, to a Git repository that Render can access.
2. In Render, choose **New → Blueprint** and select that repository. Review the workspace, region, compute plan, disk, and price before creating anything.
3. Set `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` through Render's secret environment configuration. Use sandbox PayPal credentials only. Do not upload `.env` or paste keys into GitHub files.
4. Render generates `OWNER_SETUP_TOKEN`. It also supplies `RENDER_EXTERNAL_URL`, which the app uses for HTTPS host/origin checks. Use `PUBLIC_URL` only when intentionally configuring a different canonical HTTPS origin.
5. Deploy, confirm `/healthz` returns `{"status":"ok"}`, and open the application. Create the first owner account yourself using the generated setup code. The code prevents an unrelated visitor from claiming the first owner account. It is not an account password.
6. Test project creation, live AI analysis, proposal acceptance, and a sandbox checkout. Reopen the app after a redeploy to verify persistent records and account access.

## Existing local data

Local data is deliberately excluded from the repository. A fresh disk starts with a fresh workspace. Existing local users, password hashes, sessions, project records, and proposal tokens are not silently uploaded.

If migrating the local installation, agree on a private transfer procedure first. Run `npm run db:backup` to create an integrity-checked SQLite snapshot. Restore it to the persistent directory while the target application is stopped and before creating a new cloud owner. Never copy only an active `.db` file and omit its WAL, commit a database to Git, or overwrite an active cloud database.

On Render, `npm run db:backup` writes an SQLite-native snapshot under `/var/data/backups`. Download copies securely to another location; backups on the same disk are not disaster recovery. Do not use a filesystem snapshot as the sole recovery mechanism for an active database.

## Limits

The current payment protections assume one Node process. Status reconciliation uses automatic polling, not verified PayPal webhooks, and does not reconcile later refunds or disputes. API keys and the sandbox merchant are shared by the installation; this is not multi-merchant onboarding. Email verification, password recovery by email, distributed abuse controls, and a production payment launch remain separate work.

## Official references

- [Render web services](https://render.com/docs/web-services)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [Persistent disks](https://render.com/docs/disks)
- [Node.js versions](https://render.com/docs/node-version)
