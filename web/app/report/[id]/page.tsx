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

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">
          ← {t("report.back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("report.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{metaLine}</p>
        {!d.llm_guidance && (
          <p className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-900 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-100">
            {t("report.llm_disabled_hint")}
          </p>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.summary")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--foreground)]">{d.summary}</p>
      </section>

      {d.llm_guidance && (
        <section className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 via-[var(--surface)] to-violet-50/50 p-5 shadow-[var(--card-shadow)] dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-violet-950/10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
            {t("report.llm_block_title")}
          </h2>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_overview")}</h3>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-[var(--foreground)]">
            {d.llm_guidance.overview.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para.trim()}</p>
            ))}
          </div>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_sop")}</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
            {d.llm_guidance.sop.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.llm_safety")}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
            {d.llm_guidance.safety.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs leading-relaxed text-[var(--muted)]">{d.disclaimer}</p>
    </main>
  );
}
