import { PrismaClient } from "@prisma/client";

// Next.js hot-reload re-runs modules in dev; reuse one client instead of
// opening a new DB connection on every save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
