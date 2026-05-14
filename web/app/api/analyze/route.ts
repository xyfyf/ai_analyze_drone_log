import { NextResponse } from "next/server";
import { UserContextSchema } from "@/lib/types/user-context";
import { runAnalysisPipeline } from "@/lib/analysis/run-pipeline";
import { prisma } from "@/lib/db/prisma";
import { resolveAnalyzeLocale, apiTLocale, apiT } from "@/lib/i18n/api-locale";
import type { AppLocale } from "@/lib/i18n/translate";
import { ParseLogError } from "@/lib/blackbox/parse-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 未对上传文件做字节数上限校验；大文件会占用更多内存与时间。
 * 若部署在带平台级 body 限制的环境（如部分 Serverless），需在平台侧单独调大。
 */
const ALLOWED_EXT = [".csv", ".bin", ".ulg"];

/**
 * 接收 multipart：字段 `file`（.csv / .bin / .ulg）、`userContext`（JSON 字符串）、可选 `locale`（zh|en），入库并同步跑完整分析管道。
 */
export async function POST(req: Request) {
  let locale: AppLocale = "zh";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: apiT(req, "api.need_multipart") }, { status: 400 });
    }

    const form = await req.formData();
    locale = resolveAnalyzeLocale(req, form);
    const t = (key: string, fb?: string) => apiTLocale(locale, key, fb);

    const file = form.get("file");
    const rawCtx = form.get("userContext");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: t("api.missing_file") }, { status: 400 });
    }
    if (typeof rawCtx !== "string") {
      return NextResponse.json({ error: t("api.missing_context") }, { status: 400 });
    }

    const lower = file.name.toLowerCase();
    const okExt = ALLOWED_EXT.some((ext) => lower.endsWith(ext));
    if (!okExt) {
      return NextResponse.json({ error: t("api.supported_formats") }, { status: 400 });
    }

    let userContextJson: unknown;
    try {
      userContextJson = JSON.parse(rawCtx);
    } catch {
      return NextResponse.json({ error: t("api.bad_json") }, { status: 400 });
    }

    const parsedCtx = UserContextSchema.safeParse(userContextJson);
    if (!parsedCtx.success) {
      return NextResponse.json(
        { error: t("api.bad_context"), details: parsedCtx.error.flatten() },
        { status: 400 },
      );
    }

    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const { features, diagnosis, sampleRateHz, rowCount } = await runAnalysisPipeline(
      bytes,
      file.name,
      parsedCtx.data,
      locale,
    );

    const record = await prisma.analysis.create({
      data: {
        fileName: file.name,
        rowCount,
        userContext: JSON.stringify(parsedCtx.data),
        contextValidation: JSON.stringify(diagnosis.context_validation),
        features: JSON.stringify({ ...features, sampleRateHz }),
        diagnosis: JSON.stringify(diagnosis),
        status: "done",
      },
    });

    return NextResponse.json({ id: record.id, diagnosis });
  } catch (e) {
    if (e instanceof ParseLogError) {
      return NextResponse.json({ error: apiTLocale(locale, e.i18nKey) }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : apiT(req, "api.analyze_fail");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
