# MN Group Marketplace — Full-stack starter

This version turns the original single-file marketplace demo into a local full-stack app with:

- Node.js + Express API
- Persistent JSON database (`data/db.json`) for local development
- Secure password hashing with bcrypt
- JWT authentication
- Controlled admin bootstrap (`npm run create-admin`) — public registration always creates buyer accounts
- Protected admin dashboard
- Product listing + approval workflow
- Quote-request API
- Orders API foundation
- File-upload endpoint foundation
- Admin audit log

## Run in Termux

```bash
cd ~/MN-Group
npm install
npm start
```

Then open:

`http://localhost:3000`

## Important

Public registration always creates a `buyer` account. To create (or promote an existing account to) an admin, run:

```bash
npm run create-admin
```

For production, replace the local JSON database with PostgreSQL/MySQL, set a strong `JWT_SECRET`, add HTTPS, cloud object storage, email delivery, payment-provider webhooks, rate limiting, CSRF protections where applicable, and production secrets management.


### Digital-product launch path

For the initial MN Group launch, digital products can use an optional `payhipUrl` field so the storefront can send customers to Payhip for checkout and digital delivery. PayU remains supported in the native payment layer for future first-party checkout.

## Production deployment

See `DEPLOYMENT.md` for the Render + PostgreSQL + S3/R2 deployment runbook. A ready-to-use `render.yaml` Blueprint is included; secrets are intentionally supplied through the hosting provider rather than stored in Git.
