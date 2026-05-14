import { messagesForLocale } from "@/lib/i18n/messages-for";
import { parseLocale, translate, type AppLocale } from "@/lib/i18n/translate";

/**
 * 从请求头解析语言：优先 x-locale，其次 Accept-Language 首段。
 */
export function apiLocaleFromRequest(req: Request): AppLocale {
  const h = req.headers.get("x-locale");
  if (h) return parseLocale(h);
  const al = req.headers.get("accept-language");
  const first = al?.split(",")[0]?.trim().split(";")[0]?.trim();
  return parseLocale(first);
}

/** multipart 中可选字段 `locale`（zh|en），有则覆盖请求头 */
export function localeFromFormData(form: FormData): AppLocale | null {
  const v = form.get("locale");
  if (typeof v === "string" && v.trim()) return parseLocale(v.trim());
  return null;
}

/** 分析接口：表单 locale 优先，否则请求头 */
export function resolveAnalyzeLocale(req: Request, form: FormData): AppLocale {
  return localeFromFormData(form) ?? apiLocaleFromRequest(req);
}

export function apiTLocale(locale: AppLocale, key: string, fallback?: string): string {
  return translate(messagesForLocale(locale), key, fallback);
}

/** 返回绑定到当前请求语言的 t(key) */
export function apiT(req: Request, key: string, fallback?: string): string {
  return apiTLocale(apiLocaleFromRequest(req), key, fallback);
}
