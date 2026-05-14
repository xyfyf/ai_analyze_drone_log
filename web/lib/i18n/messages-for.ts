import type { AppLocale } from "@/lib/i18n/translate";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

/** 按语言返回整包文案（服务端 / API 共用） */
export function messagesForLocale(locale: AppLocale): typeof zh {
  return locale === "en" ? en : zh;
}
