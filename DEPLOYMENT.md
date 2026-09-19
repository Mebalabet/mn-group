# MN Group — Production Deployment Runbook

This runbook is for the production candidate. It assumes Render + PostgreSQL + S3-compatible object storage (AWS S3 or Cloudflare R2) and keeps PayU credentials out of Git.

## 1. Before pushing

From the project root:

```bash
npm ci
node --check server.js
node --check config.js
node --check db/pgStore.js
node --check scripts/migrate-db.js
npm run db:migrate
```

The last command is only for a local PostgreSQL test database. Do not point it at production until you are ready.

Never commit `.env`, PayU salt, JWT secrets, S3 secret keys, database passwords, or admin passwords.

## 2. Push to GitHub

```bash
git init
git add .
git status
git commit -m "Prepare MN Group production deployment"
git branch -M main
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

If the repository already exists, only commit/push the changed files.

## 3. Render — recommended path

The repository contains `render.yaml`. Render can use it as a Blueprint and create the web service plus PostgreSQL database. The Blueprint automatically wires `DATABASE_URL`, generates a JWT secret, runs the database migration before deployment, and configures `/api/health` as the health check.

In Render:

1. Create a new Blueprint from the GitHub repository.
2. Select the repository and branch.
3. Review the `mn-group` web service and `mn-group-db` PostgreSQL database.
4. During the first Blueprint setup, enter the S3/R2 values requested for the `sync: false` variables.
5. Do **not** put secrets into `render.yaml`.
6. Deploy.
7. Wait for the database migration and web service to finish.

Render supplies the web service `PORT`; the application binds to `0.0.0.0`, so no fixed production port is required.

## 4. Create the S3/R2 storage first

Use an S3-compatible bucket for uploaded digital files. Required application variables:

```text
S3_BUCKET=<bucket name>
S3_REGION=<region or auto for R2>
S3_ENDPOINT=<R2 endpoint; leave blank for AWS S3>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_PUBLIC_BASE_URL=<optional CDN/public base URL>
```

Keep the bucket private unless you intentionally configure a public delivery model. MN Group's protected download route remains the application authorization layer.

## 5. Verify the first deployment

Open:

```text
https://<your-render-host>/api/health
```

Expected response includes:

```json
{"ok":true,"service":"MN Group API"}
```

Also verify the health response reports:

```text
db: postgres
storage: s3
env: production
```

If it reports JSON/local storage in production, stop and fix the environment variables before using the site.

## 6. Create the first production admin

After deployment, run the admin bootstrap against the production service environment using the hosting provider's shell/command facility, or temporarily run the script with the production environment variables available:

```bash
npm run create-admin
```

Use a unique strong admin password. Never send the password to ChatGPT or commit it to Git.

If the production service does not provide a shell, create/promote the admin through a controlled one-time operational method rather than enabling an admin registration endpoint.

## 7. Configure the custom domain

In Render, add `www.mngroup.in` and/or `mngroup.in` to the web service, then follow Render's DNS instructions.

After HTTPS is active, verify:

```text
https://www.mngroup.in/api/health
```

Use the exact canonical hostname you choose for PayU URLs.

## 8. Configure PayU only after merchant approval

Set these in the hosting provider's secret/environment settings — never in Git:

```text
PAYMENT_PROVIDER=payu
PAYU_MERCHANT_KEY=<live key>
PAYU_MERCHANT_SALT=<live salt>
PAYU_BASE_URL=<live PayU checkout endpoint>
PAYU_VERIFY_URL=<live PayU verification endpoint>
PAYU_SUCCESS_URL=https://<canonical-domain>/payment/success
PAYU_FAILURE_URL=https://<canonical-domain>/payment/failure
```

The signed server-to-server endpoint is:

```text
POST https://<canonical-domain>/api/payments/payu/callback
```

The existing generic endpoint remains available:

```text
POST https://<canonical-domain>/api/payments/webhook/payu
```

Both use the same handler and payment state machine; there is no duplicate payment-processing implementation.

Do not perform a live payment until PayU has approved the merchant account and supplied live credentials.

## 9. Production data rule

`data/db.json` is retained as the protected local/backup data artifact. Production uses PostgreSQL when `DATABASE_URL` is present. Do not delete or overwrite the known-good JSON backup as part of deployment.

A fresh production database is intentionally **not** seeded with the development starter catalog. Add real products through the admin workflow.

## 10. Post-deployment smoke test

Check, in this order:

1. `/api/health` returns HTTP 200.
2. Home page loads over HTTPS.
3. Register creates a buyer account.
4. Admin login works.
5. Admin can create/approve a real product.
6. A test file uploads to S3/R2.
7. The buyer cannot access an unpaid protected file.
8. A paid-order download returns only the authorized file.
9. Quote submission appears in admin.
10. Payment webhook endpoint returns a controlled response when PayU is not configured, and after PayU configuration it accepts only valid signed events.
11. Restart/redeploy the service and confirm products/users/orders remain because they are in PostgreSQL and files remain in object storage.

## 11. Do not do these in production

- Do not set `DATABASE_URL` to a local database path.
- Do not rely on `data/db.json` as the live database.
- Do not rely on `uploads/` as permanent storage.
- Do not commit `.env` or provider secrets.
- Do not expose `PAYU_MERCHANT_SALT` to the browser.
- Do not add a client-side route that marks orders paid.
- Do not bypass the payment state machine.

## One-time migration of the existing JSON data into PostgreSQL

The repository includes `scripts/import-json-data.js` specifically for the pre-launch transfer of the existing `data/db.json` records into the production PostgreSQL database. **Do not replace it with a generic JSON migration script**: this script matches the actual MN Group PostgreSQL schema and preserves the existing UUIDs, timestamps, bcrypt password hashes, product records, order/payment fields, quotes, payment-event history, and audit logs.

### Safe sequence

1. Keep an independent backup copy of `data/db.json`.
2. Create the production PostgreSQL database.
3. Run the migration from a trusted local machine or shell with the live `DATABASE_URL` supplied only as an environment variable:

```bash
DATABASE_URL="postgres://..." NODE_ENV=production node scripts/import-json-data.js
```

The script applies the idempotent `db/schema.sql`, then imports and verifies all six collections. It never writes to `data/db.json`, uses a transaction for data inserts, refuses to overwrite conflicting rows, and prints the source SHA-256 plus source/target counts.

4. Verify the reported counts and the admin account before deploying the web service.
5. Configure the same `DATABASE_URL` in Render/Railway. Production application startup will then use PostgreSQL rather than `data/db.json`.
6. Keep `data/db.json` as the offline backup. Do not delete it from the release repository unless you intentionally establish a separate protected backup process.

### Important

Do **not** run the generic example migration that assumes columns such as `users.password`, `products.title`, `orders.user_id`, or `orders.product_id`. Those columns do not match the MN Group schema. Use `npm run db:import-json` or the direct command above.
