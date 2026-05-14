import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * 按 id 返回已存储的诊断 JSON（MVP 无鉴权，生产环境须加用户校验）。
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const row = await prisma.analysis.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const diagnosis = row.diagnosis ? JSON.parse(row.diagnosis) : null;
  return NextResponse.json({
    id: row.id,
    createdAt: row.createdAt,
    fileName: row.fileName,
    rowCount: row.rowCount,
    status: row.status,
    diagnosis,
  });
}
