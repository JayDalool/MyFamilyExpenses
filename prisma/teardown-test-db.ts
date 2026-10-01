/**
 * Drop the disposable local Postgres test database created by setup-test-db.ts.
 *
 *   npm run test:db:teardown
 *
 * Same safety guard as setup: refuses to drop anything that is not clearly a
 * test database, and requires DATABASE_URL === TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "../tests/helpers/test-database";

async function main() {
  const testUrl = assertSafeTestDatabase();
  const parsed = new URL(testUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.search = "";

  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  try {
    // WITH (FORCE) terminates leftover connections (Postgres 13+).
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${databaseName.replace(/"/g, '""')}" WITH (FORCE)`,
    );
    console.log(`Dropped test database "${databaseName}".`);
  } finally {
    await admin.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
