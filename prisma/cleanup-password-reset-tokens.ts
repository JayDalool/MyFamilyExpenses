import { cleanupExpiredPasswordResetTokens } from "../lib/auth/password-reset";
import { prisma } from "../lib/db/prisma";

async function main() {
  const result = await cleanupExpiredPasswordResetTokens();
  console.log(
    `Deleted ${result.count} expired/consumed password-reset token rows past retention.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
