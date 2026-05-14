/** 日志解析失败时携带 i18n 键（由 API 层用 apiTLocale 翻译） */
export class ParseLogError extends Error {
  readonly i18nKey: string;

  constructor(i18nKey: string) {
    super(i18nKey);
    this.name = "ParseLogError";
    this.i18nKey = i18nKey;
  }
}
