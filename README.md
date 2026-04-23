# MyFamilyExpenses

MyFamilyExpenses is a self-hosted family expense tracker built with Next.js, TypeScript, Prisma, PostgreSQL, Tailwind CSS, and local file storage.

This MVP includes:

- session-based login and logout
- admin-managed categories
- invoice upload to local `/uploads`
- expense saving with a pluggable OCR stub
- filtered expense history
- expense detail pages with secure invoice preview/download
- dashboard totals for today and this month
- recent expense list
- Docker support for PostgreSQL and the Next.js app

## Tech stack

- Frontend and backend: Next.js App Router
- Language: TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Styling: Tailwind CSS
- Authentication: custom session-based auth
- Storage: local filesystem
- OCR: mock provider behind a clean interface

## Exact local setup

### 1. Create the environment file

PowerShell:

```powershell
Copy-Item .env.example .env
```

Bash:

```bash
cp .env.example .env
```

Then edit `.env` and set:

```env
SESSION_SECRET="use-a-long-random-string-here"
SEED_USER_PASSWORD="Qatarqtr22"
```

The shared seed password is intentionally supplied through your local `.env` file so it is not committed to the repository.

### 2. Install dependencies

```bash
npm install
```

### 3. Database setup

Option A, easiest for local use with Docker:

```bash
docker compose up -d db
```

This uses the default `.env.example` connection string:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myfamilyexpenses?schema=public"
```

Option B, use your own PostgreSQL service:

1. Create a database named `myfamilyexpenses`
2. Update `DATABASE_URL` in `.env`

Example SQL:

```sql
CREATE DATABASE myfamilyexpenses;
```

### 4. Run the database migration

```bash
npx prisma migrate dev --name init
```

This creates the schema and generates the Prisma client.

### 5. Seed the users and categories

```bash
npm run prisma:seed
```

The seed is idempotent and ensures these users always exist:

- `jay16ca@gmail.com` with `ADMIN` role
- `osamadaloul@hotmail.com` with `USER` role

Re-running the seed keeps categories in sync and resets both seed-user passwords to the value in `SEED_USER_PASSWORD`.

### Safe reseed for real local use

If you need to restore the seeded users safely:

1. Keep `SEED_USER_PASSWORD="Qatarqtr22"` in your local `.env`
2. Run `npm run prisma:seed`
3. Log in again with one of the seeded accounts below

The seed is idempotent. It only upserts the two known users and default categories, so it is safe to re-run without deleting existing expenses.

### 6. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## First login instructions

Use either seeded email:

- `jay16ca@gmail.com`
- `osamadaloul@hotmail.com`

Use the password from your local `.env`:

- `Qatarqtr22`

For the first admin login, use:

- email: `jay16ca@gmail.com`
- password: `Qatarqtr22`

For the first standard-user login, use:

- email: `osamadaloul@hotmail.com`
- password: `Qatarqtr22`

## Project structure

```text
app/
  api/
  auth/
  dashboard/
  expenses/
  categories/
components/
lib/
  auth/
  db/
  ocr/
  validation/
prisma/
public/
uploads/
docs/
tests/
```

## API routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/expenses`
- `GET /api/expenses/:id`
- `GET /api/expenses/:id/file`
- `POST /api/expenses`
- `GET /api/reports/summary`

## Docker

To run the full stack with Docker Compose:

```bash
docker compose up --build
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Notes

- Uploaded files are stored in the local `uploads` directory.
- The current OCR implementation is a stub in [lib/ocr/ocr.service.ts](./lib/ocr/ocr.service.ts).
- The OCR seam is ready for a real provider via [lib/ocr/types.ts](./lib/ocr/types.ts) and [lib/ocr/mock-ocr-provider.ts](./lib/ocr/mock-ocr-provider.ts).
- Architecture and deployment docs are available in the [docs](./docs) folder.
- Use `npm run prisma:seed` any time you want to safely restore the seeded users and category list on a local machine.
