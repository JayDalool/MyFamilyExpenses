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

### Recommended environment variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `NODE_ENV` | App environment | `production` |
| `APP_URL` | Public base URL | `https://expenses.example.com` |
| `DATABASE_URL` | Prisma runtime connection string | `postgresql://myfamilyexpenses:strongpassword@db:5432/myfamilyexpenses` |
| `DIRECT_URL` | Direct DB URL for Prisma migrations if needed | `postgresql://myfamilyexpenses:strongpassword@db:5432/myfamilyexpenses` |
| `AUTH_COOKIE_SECRET` | Session cookie signing/encryption secret | generated 32+ byte secret |
| `SESSION_TTL_HOURS` | Session lifetime | `168` |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | Reset token lifetime | `45` |
| `STORAGE_ROOT` | Root local file storage path inside container | `/var/lib/myfamilyexpenses` |
| `INVOICE_STORAGE_ROOT` | Final invoice storage path | `/var/lib/myfamilyexpenses/invoices` |
| `TEMP_UPLOAD_ROOT` | Draft upload path | `/var/lib/myfamilyexpenses/tmp` |
| `MAX_UPLOAD_MB` | Max upload size | `15` |
| `OCR_PROVIDER` | OCR backend selector | `paddleocr` |
| `OCR_SERVICE_URL` | Internal OCR worker URL | `http://ocr-worker:8000` |
| `OCR_TIMEOUT_MS` | OCR request timeout | `45000` |
| `RATE_LIMIT_LOGIN_PER_15M` | Login rate limit | `5` |
| `RATE_LIMIT_UPLOADS_PER_HOUR` | Upload rate limit | `30` |
| `SMTP_ENABLED` | Enable self-service password reset | `false` |
| `SMTP_HOST` | SMTP host | `smtp.example.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `mailer@example.com` |
| `SMTP_PASSWORD` | SMTP password | secret |
| `SMTP_FROM` | Sender address | `noreply@example.com` |
| `LOG_LEVEL` | App log verbosity | `info` |

### Important deployment note

If `SMTP_ENABLED=false`:

- hide the public forgot-password flow
- keep admin reset available

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

- use a long random `AUTH_COOKIE_SECRET`
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
