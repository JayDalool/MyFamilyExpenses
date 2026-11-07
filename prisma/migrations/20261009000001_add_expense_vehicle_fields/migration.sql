-- MFE-010: optional vehicle label and odometer reading on an expense.
-- Additive and nullable: existing rows keep NULL and satisfy both checks.
-- Rollback: deploy the previous code (it never reads these columns). Dropping
-- the columns is optional and loses any vehicle data entered since.

ALTER TABLE "expenses" ADD COLUMN "vehicle_label" TEXT;
ALTER TABLE "expenses" ADD COLUMN "odometer_km" INTEGER;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_odometer_km_nonnegative"
  CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0);

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_odometer_needs_vehicle"
  CHECK ("odometer_km" IS NULL OR "vehicle_label" IS NOT NULL);
