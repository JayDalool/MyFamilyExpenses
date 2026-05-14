import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { DEFAULT_CATEGORY_NAMES } from "../lib/categories/default-categories";

const prisma = new PrismaClient();

const seedUsers = [
  {
    name: "Jay Daloul",
    email: "jay16ca@gmail.com",
    role: "ADMIN" as const,
    householdRole: "OWNER" as const,
  },
  {
    name: "Osama Daloul",
    email: "osamadaloul@hotmail.com",
    role: "USER" as const,
    householdRole: "MEMBER" as const,
  },
];

async function main() {
  const seedPassword = process.env.SEED_USER_PASSWORD;

  if (!seedPassword) {
    throw new Error(
      "SEED_USER_PASSWORD is required before running the seed script so seed-user credentials stay out of the repo.",
    );
  }

  const passwordHash = await hashPassword(seedPassword);

  // Upsert all users
  const users = await Promise.all(
    seedUsers.map((u) =>
      prisma.user.upsert({
        where: { email: u.email.toLowerCase() },
        update: { name: u.name, role: u.role, passwordHash },
        create: { name: u.name, email: u.email.toLowerCase(), role: u.role, passwordHash },
      }),
    ),
  );

  // Create or find the shared family household
  let household = await prisma.household.findFirst({
    where: { name: "Daloul Family" },
  });

  if (!household) {
    household = await prisma.household.create({
      data: { name: "Daloul Family" },
    });
  }

  // Upsert memberships
  await Promise.all(
    users.map((user, index) => {
      const householdRole = seedUsers[index]!.householdRole;
      return prisma.membership.upsert({
        where: { userId_householdId: { userId: user.id, householdId: household!.id } },
        update: { role: householdRole },
        create: { userId: user.id, householdId: household!.id, role: householdRole },
      });
    }),
  );

  // Upsert categories scoped to the household
  await Promise.all(
    DEFAULT_CATEGORY_NAMES.map((name, index) =>
      prisma.category.upsert({
        where: { householdId_name: { householdId: household!.id, name } },
        update: { sortOrder: index, status: "ACTIVE" },
        create: { householdId: household!.id, name, sortOrder: index, status: "ACTIVE" },
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
