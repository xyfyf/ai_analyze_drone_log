import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import type { DiagnosisReport } from "@/lib/analysis/build-diagnosis";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { messagesForLocale } from "@/lib/i18n/messages-for";
import { translate } from "@/lib/i18n/translate";
import { interpolate } from "@/lib/i18n/interpolate";

type PageProps = { params: Promise<{ id: string }> };

/**
 * 报告详情：服务端读 Prisma；只展示 LLM 通俗解读与 SOP，规则引擎结果不再呈现。
 */
export default async function ReportPage({ params }: PageProps) {
  const { id } = await params;
  const row = await prisma.analysis.findUnique({ where: { id } });
  if (!row || !row.diagnosis) notFound();

  const locale = await getServerLocale();
  const dict = messagesForLocale(locale);
  const t = (key: string, fb?: string) => translate(dict, key, fb);

  const d = JSON.parse(row.diagnosis) as DiagnosisReport;
  const metaLine = interpolate(t("report.meta"), {
    file: row.fileName,
    rows: String(row.rowCount),
    id: row.id,
  });

  /** 新报告：从 llm_bilingual 取当前 locale；老报告：直接退到 summary + llm_guidance */
  const localized = (() => {
    const bi = d.llm_bilingual;
    if (bi) {
      const primary = locale === "en" ? bi.en : bi.zh;
      const fallback = locale === "en" ? bi.zh : bi.en;
      const pick = primary ?? fallback;
      if (pick) {
        return {
          summary: pick.summary,
          guidance: pick.guidance,
          fallbackUsed: !primary && !!fallback,
        };
      }
    }
    return { summary: d.summary, guidance: d.llm_guidance, fallbackUsed: false };
  })();

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">
          ← {t("report.back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("report.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{metaLine}</p>
        {!localized.guidance && (
          <p className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-900 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-100">
            {t("report.llm_disabled_hint")}
          </p>
        )}
        {localized.fallbackUsed && (
          <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            {t("report.locale_fallback_note")}
          </p>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.summary")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--foreground)]">{localized.summary}</p>
      </section>

      {localized.guidance && (
        <section className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 via-[var(--surface)] to-violet-50/50 p-5 shadow-[var(--card-shadow)] dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-violet-950/10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
            {t("report.llm_block_title")}
          </h2>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_overview")}</h3>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-[var(--foreground)]">
            {localized.guidance.overview.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para.trim()}</p>
            ))}
          </div>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_sop")}</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
            {localized.guidance.sop.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_safety")}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
            {localized.guidance.safety.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

    </main>
  );
}
