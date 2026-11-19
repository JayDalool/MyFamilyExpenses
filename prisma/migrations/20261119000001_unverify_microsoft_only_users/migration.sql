-- Before this release a Microsoft sign-in marked the account's email as
-- verified, but Microsoft (tenant "common") does not confirm that the person
-- owns that address. Accountant invitations trust email_verified_at, and a
-- password reset only drops linked logins on never-verified accounts, so an
-- account created that way could keep a stranger's Microsoft login after the
-- real owner takes it over. Clear the flag on accounts whose only proof was
-- that Microsoft login: no password, linked to Microsoft, not to Google.
-- The owner re-proves the inbox with a password reset, which also removes
-- the Microsoft link. Data only; old code keeps working.
UPDATE "users" AS u
SET "email_verified_at" = NULL
WHERE u."email_verified_at" IS NOT NULL
  AND u."password_hash" IS NULL
  AND EXISTS (
    SELECT 1 FROM "auth_accounts" a
    WHERE a."user_id" = u."id" AND a."provider" = 'MICROSOFT'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "auth_accounts" a
    WHERE a."user_id" = u."id" AND a."provider" = 'GOOGLE'
  );
