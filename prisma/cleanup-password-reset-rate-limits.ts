import { cleanupPasswordResetRateLimitAttempts } from "../lib/auth/password-reset-rate-limit";
import { prisma } from "../lib/db/prisma";

async function main() {
  const result = await cleanupPasswordResetRateLimitAttempts();
  console.log(
    `Deleted ${result.count} expired password-reset rate-limit rows.`,
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
