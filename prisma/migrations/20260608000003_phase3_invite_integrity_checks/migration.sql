-- Validate current invite data before adding product-level integrity checks.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "household_invites" WHERE "used_count" > "max_uses"
  ) THEN
    RAISE EXCEPTION 'Cannot add invite used_count constraint: used_count exceeds max_uses.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "household_invites" WHERE "role" = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Cannot add invite role constraint: OWNER invites exist.';
  END IF;
END $$;

ALTER TABLE "household_invites"
ADD CONSTRAINT "household_invites_used_count_lte_max_uses_check"
CHECK ("used_count" <= "max_uses") NOT VALID;

ALTER TABLE "household_invites"
VALIDATE CONSTRAINT "household_invites_used_count_lte_max_uses_check";

ALTER TABLE "household_invites"
ADD CONSTRAINT "household_invites_role_not_owner_check"
CHECK ("role" <> 'OWNER') NOT VALID;

ALTER TABLE "household_invites"
VALIDATE CONSTRAINT "household_invites_role_not_owner_check";
