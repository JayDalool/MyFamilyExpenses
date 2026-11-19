CREATE TYPE "InviteEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "household_invites"
    ADD COLUMN "email_status" "InviteEmailStatus",
    ADD CONSTRAINT "household_invites_email_status_is_accountant_check"
      CHECK (
        "email_status" IS NULL OR (
          "role" = 'ACCOUNTANT' AND
          "email" IS NOT NULL AND
          btrim("email") <> '' AND
          "max_uses" = 1
        )
      );
