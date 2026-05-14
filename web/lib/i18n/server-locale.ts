import { cookies } from "next/headers";
import type { AppLocale } from "@/lib/i18n/translate";

/** 服务端读取 Cookie `locale`（zh | en），默认 zh */
export async function getServerLocale(): Promise<AppLocale> {
  const c = (await cookies()).get("locale")?.value;
  return c === "en" ? "en" : "zh";
}
