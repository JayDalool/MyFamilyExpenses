import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

const defaultCategories = [
  "Restaurant",
  "Travel",
  "Education",
  "Groceries",
  "Utilities",
  "Medical",
  "Transportation",
  "Household",
  "Entertainment",
  "Personal",
  "Miscellaneous",
];

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME ?? "Family Admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        role: "ADMIN",
      },
    });
  }

  await Promise.all(
    defaultCategories.map((name, index) =>
      prisma.category.upsert({
        where: { name },
        update: {
          sortOrder: index,
          status: "ACTIVE",
        },
        create: {
          name,
          sortOrder: index,
          status: "ACTIVE",
        },
      }),
    ),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
