import { deleteStaleExtractionAttempts } from "../lib/ocr/extraction-attempt";
import { prisma } from "../lib/db/prisma";

async function main() {
  const result = await deleteStaleExtractionAttempts();
  console.log(`Deleted ${result.count} expired/consumed extraction attempts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
