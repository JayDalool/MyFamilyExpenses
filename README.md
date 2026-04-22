# MyFamilyExpenses

MyFamilyExpenses is a self-hosted family expense tracker built with Next.js, TypeScript, Prisma, PostgreSQL, Tailwind CSS, and local file storage.

This MVP includes:

- session-based login and logout
- admin-managed categories
- invoice upload to local `/uploads`
- expense saving with a pluggable OCR stub
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
- OCR: mock service with a replaceable interface

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

## Local setup

1. Copy the environment file.

```bash
cp .env.example .env
```

2. Install dependencies.

```bash
npm install
```

3. Start PostgreSQL locally.

You can use your own PostgreSQL instance or the included Docker Compose file:

```bash
docker compose up -d db
```

4. Create the database schema.

```bash
npx prisma migrate dev --name init
```

5. Seed the default admin user and categories.

```bash
npm run prisma:seed
```

6. Start the app.

```bash
npm run dev
```

7. Sign in with the seeded admin account from `.env`.

## API routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/expenses`
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
- Architecture and deployment docs are available in the [docs](./docs) folder.
