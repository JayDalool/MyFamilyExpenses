const TEST_MARKER = /(^|[_-])(ci|disposable|e2e|temp|test|tests|testing|tmp)([_-]|$)/i;
const PRODUCTION_MARKER = /(^|[_-])(live|prod|production)([_-]|$)/i;

export function validateSafeTestDatabase(
  databaseUrl: string | undefined,
  testDatabaseUrl: string | undefined,
) {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for DB-backed tests.");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for DB-backed tests.");
  }
  if (databaseUrl !== testDatabaseUrl) {
    throw new Error(
      "Refusing DB-backed tests because DATABASE_URL must exactly equal TEST_DATABASE_URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid database URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DB-backed tests require a PostgreSQL test database.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const schemaName = parsed.searchParams.get("schema") ?? "public";
  if (!databaseName) {
    throw new Error("TEST_DATABASE_URL must include a database name.");
  }
  if (PRODUCTION_MARKER.test(databaseName)) {
    throw new Error("Refusing DB-backed tests against a production-looking database name.");
  }

  const hasTestDatabaseName = TEST_MARKER.test(databaseName);
  const hasDisposableSchema =
    schemaName.toLowerCase() !== "public" && TEST_MARKER.test(schemaName);
  if (!hasTestDatabaseName && !hasDisposableSchema) {
    throw new Error(
      "TEST_DATABASE_URL must clearly identify a test database or disposable test schema.",
    );
  }

  return testDatabaseUrl;
}

export function assertSafeTestDatabase() {
  return validateSafeTestDatabase(
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
  );
}
