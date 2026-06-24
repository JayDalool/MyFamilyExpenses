/**
 * Provision a disposable local Postgres test database for DB-backed integration
 * tests (Phase B/C, OCR learning, reporting, password reset).
 *
 * Reads DATABASE_URL + TEST_DATABASE_URL from the environment. Run it through the
 * npm script so they are loaded from `.env.test`:
 *
 *   npm run test:db:setup
 *
 * Safety: the URLs are validated by the same guard the tests use
 * (assertSafeTestDatabase) — both env vars must be byte-for-byte identical and
 * must clearly name a *test* database. This script refuses to touch anything that
 * looks like a real/dev/prod database.
 *
 * It creates the test database if missing, then applies all migrations with
 * `prisma migrate deploy`. It never drops or mutates an existing dev/prod DB.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "../tests/helpers/test-database";

async function ensureDatabaseExists(testUrl: string) {
  const parsed = new URL(testUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

  // Connect to the always-present "postgres" maintenance database on the same
  // server to check for / create the test database. We drop the schema search
  // param so we connect to the maintenance DB's default schema.
  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.search = "";

  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      "SELECT datname FROM pg_database WHERE datname = $1",
      databaseName,
    );
    if (existing.length > 0) {
      console.log(`Test database "${databaseName}" already exists.`);
      return;
    }
    // databaseName comes from our own already-validated test URL. Quote it to be
    // safe; CREATE DATABASE cannot run inside a transaction, which $executeRawUnsafe
    // honors (it issues the statement directly).
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    console.log(`Created test database "${databaseName}".`);
  } finally {
    await admin.$disconnect();
  }
}

async function main() {
  // Throws unless DATABASE_URL === TEST_DATABASE_URL and the target is clearly a
  // test database. This is the same guard every DB-backed test runs at load.
  const testUrl = assertSafeTestDatabase();

  await ensureDatabaseExists(testUrl);

  // Apply migrations. The Prisma CLI reads DATABASE_URL from its environment and
  // also auto-loads `.env` (which points at the DEV database). We pass an explicit
  // DATABASE_URL so the test URL always wins — dotenv never overrides a value that
  // is already set in the process environment.
  console.log("Applying migrations with `prisma migrate deploy`...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  console.log("Test database is ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
