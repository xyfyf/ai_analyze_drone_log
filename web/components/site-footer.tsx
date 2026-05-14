"use client";

import { useI18n } from "@/app/providers";

/** 页脚免责声明与商标说明 */
export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-white/50 bg-white/50 py-10 text-center text-xs leading-relaxed text-[var(--muted)] backdrop-blur-md dark:border-white/5 dark:bg-slate-950/40">
      <div className="mx-auto max-w-3xl space-y-3 px-4">
        <p className="text-[var(--foreground)]/80">{t("footer.line1")}</p>
        <p className="opacity-90">{t("footer.line2")}</p>
      </div>
    </footer>
  );
}
