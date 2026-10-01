import assert from "node:assert/strict";
import test from "node:test";
import { validateSafeTestDatabase } from "./helpers/test-database";

const safeUrl =
  "postgresql://user:password@localhost:5432/myfamilyexpenses?schema=mfe_phase3_tests_1234";

test("test database guard accepts matching disposable schemas", () => {
  assert.equal(validateSafeTestDatabase(safeUrl, safeUrl), safeUrl);
});

test("test database guard rejects missing and mismatched URLs", () => {
  assert.throws(() => validateSafeTestDatabase(undefined, undefined));
  assert.throws(() => validateSafeTestDatabase(safeUrl, undefined));
  assert.throws(() =>
    validateSafeTestDatabase(
      "postgresql://user:password@localhost:5432/myfamilyexpenses?schema=public",
      safeUrl,
    ),
  );
});

test("test database guard rejects unclear and production-looking targets", () => {
  const unclear =
    "postgresql://user:password@localhost:5432/myfamilyexpenses?schema=public";
  const production =
    "postgresql://user:password@localhost:5432/myfamilyexpenses_prod?schema=mfe_tests";

  assert.throws(() => validateSafeTestDatabase(unclear, unclear));
  assert.throws(() => validateSafeTestDatabase(production, production));
});
