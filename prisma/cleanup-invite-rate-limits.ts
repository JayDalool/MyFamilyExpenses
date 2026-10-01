import { cleanupInviteRateLimitAttempts } from "../lib/invite-rate-limit";
import { prisma } from "../lib/db/prisma";

async function main() {
  const result = await cleanupInviteRateLimitAttempts();
  console.log(`Deleted ${result.count} expired invite rate-limit rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
