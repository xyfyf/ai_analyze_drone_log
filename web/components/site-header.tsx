"use client";

import Link from "next/link";
import { useI18n } from "@/app/providers";
import { BrandLogo } from "@/components/brand-logo";

/**
 * 顶栏：品牌、主导航、语言切换（中 / EN）。
 */
export function SiteHeader() {
  const { locale, t, setLocale, pending } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-[var(--surface)]/70 shadow-sm backdrop-blur-xl dark:border-white/5 dark:bg-[var(--surface)]/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
        <Link href="/" className="group flex items-center gap-2.5 leading-tight" aria-label={t("brand.name")}>
          <span className="shrink-0 rounded-xl shadow-md shadow-indigo-500/25 ring-1 ring-white/30 transition group-hover:scale-105 group-hover:shadow-lg dark:ring-white/10">
            <BrandLogo className="h-9 w-9" />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-[var(--foreground)] group-hover:text-[var(--accent)]">
              {t("brand.name")}
            </span>
            <span className="hidden text-[11px] text-[var(--muted)] sm:inline">{t("brand.tagline")}</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          <Link
            href="/"
            className="rounded-full px-3 py-1.5 text-[var(--muted)] transition hover:bg-white/60 hover:text-[var(--foreground)] dark:hover:bg-white/10"
          >
            {t("nav.home")}
          </Link>
          <Link
            href="/chat"
            className="rounded-full px-3 py-1.5 text-[var(--muted)] transition hover:bg-white/60 hover:text-[var(--foreground)] dark:hover:bg-white/10"
          >
            {t("nav.chat")}
          </Link>
          <div
            className="ml-1 flex rounded-full border border-[var(--border)] bg-white/50 p-0.5 text-xs shadow-inner dark:bg-white/5"
            role="group"
            aria-label={t("nav.lang_aria")}
          >
            <button
              type="button"
              disabled={pending}
              onClick={() => setLocale("zh")}
              className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                locale === "zh" ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("nav.lang_short_zh")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setLocale("en")}
              className={`rounded-full px-2.5 py-1 font-semibold transition-all ${
                locale === "en" ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("nav.lang_short_en")}
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
