# MyFamilyExpenses Self-Hosted Deployment Guide

## 1. Deployment strategy

Deploy MyFamilyExpenses as four local services:

- `caddy` for HTTPS and reverse proxy
- `web` for the Next.js app
- `db` for PostgreSQL
- `ocr-worker` for local OCR processing

This is the recommended first production setup for a personal PC or home server because it is:

- low-cost
- easy to back up
- easy to migrate later
- simple to reason about

## 2. Recommended host setup

### Preferred production host

Preferred host OS:

- Ubuntu LTS or another stable Linux server

If you are hosting on a Windows PC:

- run through `WSL2 + Docker Desktop` or a Linux VM
- keep the app services inside Linux for fewer OCR and reverse-proxy issues

### Why Linux is preferred

- better support for PaddleOCR and native OCR dependencies
- better support for Caddy and Docker bind mounts
- easier backups and automation with `cron`, `systemd`, and `rsync`

## 3. Recommended topology

```text
Internet or LAN
        |
     80/443
        |
      Caddy
        |
   Next.js web app
        |
  -------------------
  |        |        |
Postgres  OCR    Invoice files
          worker   on local disk
```

Rules:

- Only Caddy should be exposed to clients.
- PostgreSQL must not be exposed publicly.
- OCR worker must be internal-only.
- Invoice files must live on a host directory mounted into the app container.

## 4. Host directory layout

Use a host directory structure like this:

```text
/srv/myfamilyexpenses/
├─ app/
├─ data/
│  ├─ postgres/
│  ├─ invoices/
│  ├─ tmp/
│  ├─ caddy-data/
│  └─ caddy-config/
├─ backups/
│  ├─ db/
│  ├─ files/
│  └─ logs/
└─ env/
   └─ .env.production
```

If you use Windows + WSL2, use the Linux path inside WSL, not a Windows-mounted path, for best performance.

## 5. Environment variable strategy

### Rules

- Keep production secrets only in `.env.production` or your host secret manager.
- Commit `.env.example`, never commit real secrets.
- Keep app config and infrastructure config separate where possible.
- Use one app URL and one storage root.

### Environment variables

Every variable below is read by the code; the file reference is where. Anything
not listed here is not read by anything. `.env.example` carries the subset a
normal deploy needs — copy it to `.env` and fill it in.

**Required**

| Variable | Purpose | Read at |
| --- | --- | --- |
| `DATABASE_URL` | Prisma connection string | `prisma/schema.prisma` |
| `SESSION_SECRET` | Session HMAC key. Validated: in production it must be >=32 characters and not a placeholder, or the app fails closed | `lib/auth/session.ts:45`, `lib/auth/session-secret.ts` |
| `APP_BASE_URL` | Public base URL. Auth flows throw without it (a request-derived fallback covers some paths) | `lib/auth/app-url.ts:2` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Compose only — they build the `db` container and the app's `DATABASE_URL` | `docker-compose.yml` |

**Optional, with the default the code applies**

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | App environment | set to `production` by `docker-compose.yml` |
| `APP_TIME_ZONE` | Time zone for dashboard and report period labels | `UTC` |
| `SESSION_COOKIE_NAME` | Session cookie name | `mfe_session` |
| `ACTIVE_HOUSEHOLD_COOKIE_NAME` | Active-household cookie name | `mfe_household` |
| `SESSION_TTL_DAYS` | Session lifetime in days | `7` |
| `COOKIE_SECURE` | Force the Secure cookie flag. `true`/`false` override; otherwise derived from `NODE_ENV` | derived |
| `TRUST_PROXY_HEADERS` | Honour `X-Forwarded-For` for rate limiting. Only turn on behind a proxy you control | `false` |
| `ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP` | Let the first login create a household | `false` |
| `UPLOAD_DIR` | Receipt storage root. Must be absolute or it is ignored | `<cwd>/uploads` |
| `MAX_UPLOAD_MB` | Maximum upload size | `10` |

**OCR**

| Variable | Purpose | Default |
| --- | --- | --- |
| `OCR_PROVIDER` | `tesseract` \| `paddle` \| `mock` (non-production only). An unknown or empty value fails closed | `tesseract` |
| `OCR_STRATEGY` | `single` \| `fallback` \| `parallel` \| `ensemble` | `single` |
| `OCR_SERVICE_URL` | PaddleOCR sidecar URL. Required when `OCR_PROVIDER=paddle` | none |
| `OCR_TIMEOUT_MS` | Paddle request timeout, clamped to 1000-8000 | clamped |
| `TESSERACT_CACHE_DIR` | Tesseract model cache | `<cwd>/.cache/tesseract` |
| `TESSERACT_LANG_PATH` | Tesseract language data path | library default |
| `OCR_DEBUG`, `OCR_DEBUG_DIR` | Write per-extraction debug artifacts | off, `<cwd>/.cache/ocr-debug` |
| `OCR_TEMPLATE_MODE` | Static merchant-template mode | off |
| `OCR_TEMPLATE_APPLY_IN_PRODUCTION` | Allow template application in production | `false` |

**Email** (see the SMTP note below — `SMTP_ENABLED=false` changes signup and
password-reset behaviour)

| Variable | Purpose | Default |
| --- | --- | --- |
| `SMTP_ENABLED` | Enable verification and password-reset email | `false` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP credentials and sender | empty |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | TLS on connect; `true` for port 465 | `false` |
| `DEV_SHOW_VERIFICATION_LINKS` | Return verification and reset URLs in API responses. Development only, ignored in production | `false` |

**OAuth** (both providers are off unless their `*_OAUTH_ENABLED` is `true`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `GOOGLE_OAUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google sign-in | off |
| `MICROSOFT_OAUTH_ENABLED`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_TENANT_ID` | Microsoft sign-in | off, tenant `common` |

**Seeding and tests**

| Variable | Purpose | Notes |
| --- | --- | --- |
| `SEED_USER_PASSWORD` | Password for the seeded user | Deliberately absent from the long-running app container. Run `docker compose run --rm app npx tsx prisma/seed.ts` |
| `TEST_DATABASE_URL` | Test database, must equal `DATABASE_URL` byte for byte | See `docs/testing.md` |

Rate limits (login, invites, password reset) are enforced with database tables
rather than environment variables, so there is nothing to configure.

### OCR provider note (current vs planned)

- **Production: set `OCR_PROVIDER=tesseract` and `OCR_STRATEGY=single`.** This is
  the only supported production configuration today: one known-good local engine
  with a predictable latency profile. Image OCR runs in-process via
  `tesseract.js`; PDF OCR is not supported yet and PDFs fall back to manual entry.
- **Do not run `OCR_STRATEGY=ensemble` (or `parallel`) in production while the
  engines run sequentially.** The orchestrator awaits the primary engine before
  the secondary/legacy strategies start, so a slow or unreachable Paddle sidecar
  makes every upload wait out Paddle's full timeout (`OCR_TIMEOUT_MS`, up to 8 s)
  *before* Tesseract runs — the user pays Paddle's worst case first even when only
  Tesseract ends up producing a result (`providersUsed=["tesseract"]`). Use
  `ensemble`/`parallel` for local evaluation only; adopt `fallback` with Paddle
  once it is validated. See `docs/ocr-multi-engine-strategy.md`.
- **Local / test / dev only: `OCR_PROVIDER=mock`** for deterministic, synthetic
  output. The `mock` engine is **hard-blocked in production** (selecting it with
  `NODE_ENV=production` is a fatal config error).
- Unknown `OCR_PROVIDER` values **fail closed** with a config error — there is no
  silent fallback to mock. The canonical Paddle name is **`paddle`**;
  `paddleocr` is **not** accepted and fails closed.
- **PaddleOCR is scaffolded and experimental — not the production default.** An
  internal sidecar (`services/paddle-ocr`) and the Next engine
  (`lib/ocr/paddle-ocr-engine.ts`) exist and are wired through Docker Compose,
  but the model has not been load-tested here. Keep `OCR_PROVIDER=tesseract` in
  production until you have validated Paddle yourself. It does **not** add OCR
  persistence yet.

#### Enabling the PaddleOCR sidecar (opt-in)

The OCR service is in a separate Compose override so it never starts in a normal
deploy. To run it:

```bash
docker compose -f docker-compose.yml -f docker-compose.ocr.yml up -d
```

Including `docker-compose.ocr.yml` starts the internal `ocr` service and sets
`OCR_SERVICE_URL=http://ocr:8000` and `OCR_TIMEOUT_MS` on the `app` container.
With the base `docker-compose.yml` alone, none of this exists.

It does **not** switch the app to Paddle. Paddle measured slower and less
accurate than Tesseract on this hardware, so the override defaults to
`OCR_PROVIDER=tesseract` / `OCR_STRATEGY=single` and both are read from the
environment (`${OCR_PROVIDER:-tesseract}`). To benchmark Paddle, set
`OCR_PROVIDER=paddle` (and optionally `OCR_STRATEGY=ensemble`) in the
environment file while the override is included. Measure before making it the
default again.

Hard requirements (enforced by the override / service):

- **No public port** — the `ocr` service is reachable only on the internal
  Docker network via the name `ocr`. Never add a host `ports:` mapping for it.
- **No uploads volume mounted into Paddle** — bytes are passed per request.
- **No DB access and no app secrets** are given to the OCR service.
- The Next engine enforces a **5–8 s total timeout** (`OCR_TIMEOUT_MS`, clamped
  to 1000–8000 ms). On timeout / network error / 5xx / malformed response it
  returns a controlled OCR error so the user can enter fields manually — it does
  **not** fabricate data and does **not** silently fall back to mock.
- Resources: PaddleOCR is CPU-bound (~1–4 s/image) and needs ~1–2 GB RAM. Run
  one worker per container and scale with replicas; CPU/memory limits are set in
  the override. See `services/paddle-ocr/README.md` for model preloading and
  tuning.

### Local Compose overrides

`docker-compose.yml` is the clean default deploy and is committed as such: the
app publishes `127.0.0.1:3000:3000` and Postgres is not published at all. Do not
edit it for one host.

Host-specific changes go in `docker-compose.override.yml`, which Compose loads
automatically and which is gitignored. Start from the committed template:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
```

The template covers the two cases that come up here: moving the app to a free
host port (`ports: !override` replaces the base list instead of appending to
it, so port 3000 is not published as well), and a loopback-only Postgres
mapping for psql or Prisma access. Keep both on `127.0.0.1`.

### Important deployment note

If `SMTP_ENABLED=false`:

- the public signup verification flow fails closed in production (signup
  returns 503 because the operator cannot send the verification email)
- the public forgot-password flow ALWAYS returns the same generic 202 body
  (`"If an account exists for that email, a password reset link has been
  sent."`) — even when SMTP is unavailable. This is intentional: returning a
  503 only when SMTP is broken AND the email is recognised would leak account
  existence to an attacker probing the endpoint. The operator-visible failure
  is recorded via `console.error` and an `auth.password_reset.email_unavailable`
  audit-log entry. Configure SMTP in production so reset emails are actually
  delivered.
- keep admin reset available via direct DB operations

If `SMTP_ENABLED=true`:

- password reset tokens are valid for 30 minutes and are single-use
- raw reset tokens are never stored in the database or written to logs
- reset URLs are never logged in production; only the SHA-256 hash of the
  token appears in audit logs
- successful password resets invalidate every active session for that user,
  so the user is forced to sign in again with the new password

## 6. Docker Compose blueprint

Use Docker Compose as the default deployment mechanism.

Example `docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - /srv/myfamilyexpenses/data/caddy-data:/data
      - /srv/myfamilyexpenses/data/caddy-config:/config
    depends_on:
      - web

  web:
    build:
      context: .
      dockerfile: ./docker/web.Dockerfile
    restart: unless-stopped
    env_file:
      - /srv/myfamilyexpenses/env/.env.production
    depends_on:
      - db
      - ocr-worker
    volumes:
      - /srv/myfamilyexpenses/data/invoices:/var/lib/myfamilyexpenses/invoices
      - /srv/myfamilyexpenses/data/tmp:/var/lib/myfamilyexpenses/tmp

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: myfamilyexpenses
      POSTGRES_USER: myfamilyexpenses
      POSTGRES_PASSWORD: change-me
    volumes:
      - /srv/myfamilyexpenses/data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myfamilyexpenses -d myfamilyexpenses"]
      interval: 10s
      timeout: 5s
      retries: 5

  ocr-worker:
    build:
      context: .
      dockerfile: ./docker/ocr-worker.Dockerfile
    restart: unless-stopped
    env_file:
      - /srv/myfamilyexpenses/env/.env.production
    volumes:
      - /srv/myfamilyexpenses/data/invoices:/var/lib/myfamilyexpenses/invoices
      - /srv/myfamilyexpenses/data/tmp:/var/lib/myfamilyexpenses/tmp
```

### Notes

- Keep `db` off published ports unless you explicitly need local admin access.
- Mount invoice and temp storage into both `web` and `ocr-worker`.
- Use a real secret in `POSTGRES_PASSWORD`, not the placeholder above.

## 7. Reverse proxy and SSL

### Recommended reverse proxy

Use `Caddy`.

Why:

- simpler HTTPS management for personal servers
- easier than hand-managing certbot plus nginx for this use case
- good default security posture

### Public internet deployment

Use a real domain such as:

- `expenses.yourdomain.com`

Example `Caddyfile`:

```caddyfile
expenses.example.com {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    reverse_proxy web:3000
}
```

Requirements:

- DNS A/AAAA record points to your server
- ports `80` and `443` forwarded to your server
- firewall allows `80` and `443`

### LAN-only deployment

If you only want local/private network access, prefer:

- LAN-only firewall rules
- no public port forwarding
- optional VPN for remote access

Example local-only `Caddyfile`:

```caddyfile
expenses.home.arpa {
    tls internal
    reverse_proxy web:3000
}
```

Important:

- client devices must trust Caddy's local CA for warning-free HTTPS
- for many families, a VPN is safer than exposing the app publicly

### Best remote-access recommendation

If you need access away from home, prefer:

- WireGuard
- Tailscale
- another VPN you trust

This is safer than exposing your personal server directly to the public internet.

## 8. First deployment steps

### Step 1: Prepare the host

- Install Docker and Docker Compose support
- Create the `/srv/myfamilyexpenses` directory structure
- Create `/srv/myfamilyexpenses/env/.env.production`
- Set strong secrets and database password

### Step 2: Build and start services

```bash
docker compose build
docker compose up -d
```

### Step 3: Run database migrations

```bash
docker compose exec web npx prisma migrate deploy
```

### Step 4: Seed initial data

Seed:

- first admin user
- default categories

Example:

```bash
docker compose exec web npm run seed
```

### Step 5: Verify health

Check:

- app loads through Caddy
- login works
- category list loads
- upload works
- OCR worker receives jobs
- files are written to mounted storage

## 9. Local file storage design

### Recommended storage layout inside the container

```text
/var/lib/myfamilyexpenses/
├─ invoices/
│  ├─ 2026/
│  │  ├─ 04/
│  │  │  ├─ <expense-id>.pdf
│  │  │  └─ <expense-id>.jpg
├─ tmp/
│  └─ drafts/
│     └─ <draft-id>/
│        └─ source-upload.pdf
```

### Storage rules

- Final invoices go in year/month folders.
- Draft uploads go under temp draft paths.
- The database stores logical file paths, not user-supplied paths.
- Delete temp draft files after completion or expiry.

## 10. Backup strategy

### Minimum recommended backups

Back up three things:

- PostgreSQL database
- invoice file storage
- environment/secrets backup kept securely outside the repo

### Database backups

Nightly logical backup:

```bash
docker compose exec -T db pg_dump -U myfamilyexpenses -Fc myfamilyexpenses > /srv/myfamilyexpenses/backups/db/myfamilyexpenses-$(date +%F).dump
```

Weekly globals backup:

```bash
docker compose exec -T db pg_dumpall -U myfamilyexpenses --globals-only > /srv/myfamilyexpenses/backups/db/postgres-globals-$(date +%F).sql
```

### File backups

Use `rsync`, `restic`, `borg`, or your preferred backup tool to copy:

- `/srv/myfamilyexpenses/data/invoices`

at least daily.

### Retention

Suggested starting policy:

- 7 daily backups
- 4 weekly backups
- 6 monthly backups

### Restore drill

Test monthly:

1. restore database backup into a test environment
2. restore invoice files
3. verify the app can open historical expenses

## 11. Security operations

### Network exposure

If LAN-only:

- do not forward ports on your router
- allow access only from your local subnet or VPN

If public:

- expose only `80` and `443`
- never expose PostgreSQL
- never expose OCR worker
- keep your OS and containers patched

### Authentication and secrets

- use a long random `SESSION_SECRET` (>=32 characters; the app refuses a
  placeholder in production)
- use strong database passwords
- rotate secrets if a host is compromised
- keep `.env.production` readable only by the deployment user

### File upload safety

- enforce MIME and file signature validation
- set upload size limit at reverse proxy and app level
- keep files outside web root
- optionally add ClamAV later if desired

### Rate limiting

Apply at:

- Caddy if you add a plugin or a sidecar limiter later
- app level for login, forgot password, and upload routes

## 12. Operations checklist

Before calling the system production-ready, confirm:

- HTTPS works
- backups run automatically
- restore test has been performed
- admin can create users
- user can upload and save an expense
- OCR failure path still allows manual correction
- audit logs are written for sensitive actions
- only Caddy is exposed externally

## 13. Migration path for later cloud or larger hosting

This design is intentionally portable.

Later, you can replace:

- local file storage -> S3-compatible object storage
- local OCR worker -> external OCR provider
- single-node Postgres -> managed Postgres
- single web instance -> multiple instances with shared storage and cache

Because the app uses:

- Prisma for data access
- a storage abstraction
- an OCR provider interface

the migration path stays straightforward.

## 14. Reference notes

- Next.js self-hosting guide: [nextjs.org/docs/pages/guides/self-hosting](https://nextjs.org/docs/pages/guides/self-hosting)
- Caddy automatic HTTPS: [caddyserver.com/docs/automatic-https](https://caddyserver.com/docs/automatic-https)
- PostgreSQL SQL dump and pg_dump guidance: [postgresql.org/docs/17/backup-dump.html](https://www.postgresql.org/docs/17/backup-dump.html) and [postgresql.org/docs/current/app-pgdump.html](https://www.postgresql.org/docs/current/app-pgdump.html)
- OWASP session management: [cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- OWASP file upload: [cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Invite rate-limit maintenance

Required before production: schedule `npm run maintenance:invite-rate-limits`
to run daily. It removes database-backed invite limiter rows older than the
safe retention window. Do not deploy Phase 3 without this recurring cleanup
being scheduled and monitored.

## Password reset maintenance

Required before production: schedule both of the following daily.

- `npm run maintenance:password-reset-rate-limits` — drops rows in
  `password_reset_rate_limit_attempts` past their 7-day retention. The table
  is append-only during operation; cleanup keeps it bounded and the
  windowed-count queries fast.
- `npm run maintenance:password-reset-tokens` — drops rows in
  `password_reset_tokens` whose `expires_at` or `used_at` is past the 7-day
  retention window. Used tokens stay around briefly for forensic correlation
  (each row's `requested_ip_hash` / `requested_user_agent_hash` confirms which
  session burned the link), then are dropped. Never affects active tokens.

Both helpers are no-ops when there is nothing to delete; they are safe to run
on a quiet system. Do not deploy Phase 3.5 without both jobs scheduled and
monitored.
