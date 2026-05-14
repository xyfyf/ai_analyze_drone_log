import { PrismaClient } from "@prisma/client";

/**
 * Prisma 单例：避免 Next.js 热重载时重复创建连接（SQLite 亦适用）。
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
