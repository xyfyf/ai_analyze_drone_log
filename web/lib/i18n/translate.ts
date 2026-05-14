/**
 * 按点号路径从嵌套对象取字符串；缺失时返回 fallbackKey（便于发现漏译）。
 */
export function translate(dict: unknown, keyPath: string, fallback?: string): string {
  const parts = keyPath.split(".").filter(Boolean);
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return fallback ?? keyPath;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : fallback ?? keyPath;
}

export type AppLocale = "zh" | "en";

/** 从 Cookie、Accept-Language 或表单字段解析界面语言 */
export function parseLocale(v: string | undefined): AppLocale {
  if (!v) return "zh";
  const s = v.trim().toLowerCase();
  if (s === "en" || s.startsWith("en-")) return "en";
  if (s === "zh" || s.startsWith("zh-")) return "zh";
  return "zh";
}
