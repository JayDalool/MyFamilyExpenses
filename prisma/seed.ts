import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

const seedUsers = [
  {
    name: "Osama Daloul",
    email: "osamadaloul@hotmail.com",
    role: "USER" as const,
  },
  {
    name: "Jay Daloul",
    email: "jay16ca@gmail.com",
    role: "ADMIN" as const,
  },
];

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
  const seedPassword = process.env.SEED_USER_PASSWORD;

  if (!seedPassword) {
    throw new Error(
      "SEED_USER_PASSWORD is required before running the seed script so seed-user credentials stay out of the repo.",
    );
  }

  const passwordHash = await hashPassword(seedPassword);

  await Promise.all(
    seedUsers.map((user) =>
      prisma.user.upsert({
        where: {
          email: user.email.toLowerCase(),
        },
        update: {
          name: user.name,
          role: user.role,
          passwordHash,
        },
        create: {
          name: user.name,
          email: user.email.toLowerCase(),
          role: user.role,
          passwordHash,
        },
      }),
    ),
  );

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
