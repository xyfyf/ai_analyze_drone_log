import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import type { DiagnosisReport } from "@/lib/analysis/build-diagnosis";
import type { PidAxis } from "@/lib/analysis/pid-recommendation";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { messagesForLocale } from "@/lib/i18n/messages-for";
import { translate } from "@/lib/i18n/translate";
import { interpolate } from "@/lib/i18n/interpolate";

type PageProps = { params: Promise<{ id: string }> };

function PidMiniTable({
  current,
  proposed,
  labels,
}: {
  current: { roll: PidAxis; pitch: PidAxis; yaw: PidAxis };
  proposed: { roll: PidAxis; pitch: PidAxis; yaw: PidAxis };
  labels: {
    axis_roll: string;
    axis_pitch: string;
    axis_yaw: string;
    p: string;
    i: string;
    d: string;
    cur: string;
    prop: string;
  };
}) {
  const rows: { name: string; c: PidAxis; p: PidAxis }[] = [
    { name: labels.axis_roll, c: current.roll, p: proposed.roll },
    { name: labels.axis_pitch, c: current.pitch, p: proposed.pitch },
    { name: labels.axis_yaw, c: current.yaw, p: proposed.yaw },
  ];
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full min-w-[320px] text-left text-sm">
        <thead className="bg-[var(--surface-elevated)]/60 text-xs uppercase text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium" colSpan={3}>
              {labels.cur}
            </th>
            <th className="px-3 py-2 font-medium" colSpan={3}>
              {labels.prop}
            </th>
          </tr>
          <tr>
            <th className="px-3 py-2 font-medium"> </th>
            <th className="px-2 py-1 font-mono">{labels.p}</th>
            <th className="px-2 py-1 font-mono">{labels.i}</th>
            <th className="px-2 py-1 font-mono">{labels.d}</th>
            <th className="px-2 py-1 font-mono">{labels.p}</th>
            <th className="px-2 py-1 font-mono">{labels.i}</th>
            <th className="px-2 py-1 font-mono">{labels.d}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-medium text-[var(--foreground)]">{row.name}</td>
              <td className="px-2 py-2 font-mono text-xs">{row.c.P}</td>
              <td className="px-2 py-2 font-mono text-xs">{row.c.I}</td>
              <td className="px-2 py-2 font-mono text-xs">{row.c.D}</td>
              <td className="px-2 py-2 font-mono text-xs text-[var(--accent)]">{row.p.P}</td>
              <td className="px-2 py-2 font-mono text-xs text-[var(--accent)]">{row.p.I}</td>
              <td className="px-2 py-2 font-mono text-xs text-[var(--accent)]">{row.p.D}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 报告详情：服务端读 Prisma；优先展示 LLM 通俗解读与 SOP，技术 JSON 默认折叠。
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

  const pidLabels = {
    axis_roll: t("report.axis_roll"),
    axis_pitch: t("report.axis_pitch"),
    axis_yaw: t("report.axis_yaw"),
    p: t("report.pid_table_p"),
    i: t("report.pid_table_i"),
    d: t("report.pid_table_d"),
    cur: t("report.pid_table_current"),
    prop: t("report.pid_table_proposed"),
  };

  const metrics = d.stability_analysis.metrics;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">
          ← {t("report.back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("report.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{metaLine}</p>
        {d.llm_guidance ? (
          <p className="rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-100">
            {t("report.body_llm_note")}
          </p>
        ) : (
          <p className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-900 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-100">
            {t("report.llm_disabled_hint")}
          </p>
        )}
        <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          {t("report.body_mix_note")}
        </p>
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

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.validation")}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--foreground)]">
          {d.context_validation.map((c) => (
            <li key={c.code}>
              <span className="font-mono text-xs text-[var(--muted)]">{c.level}</span> {c.message}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.hypotheses")}</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {d.hypotheses.map((h, i) => (
            <li key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4">
              <div className="text-xs font-medium text-[var(--muted)]">
                {t("report.type_label")}: {t(`report.hypothesisTypes.${h.type}`, h.type)}
              </div>
              <div className="mt-1 text-[var(--foreground)]">
                {t("report.confidence")}: {(h.confidence * 100).toFixed(0)}%
              </div>
              {h.user_context_boost && <div className="mt-2 text-sm text-[var(--muted)]">{h.user_context_boost}</div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.jitter")}</h2>
        <h3 className="mt-3 text-xs font-semibold text-[var(--muted)]">{t("report.metrics_title")}</h3>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {Object.entries(metrics).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-[var(--border)]/60 py-1.5">
              <dt className="font-mono text-xs text-[var(--muted)]">{k}</dt>
              <dd className="text-right font-mono text-xs text-[var(--foreground)]">{typeof v === "number" ? v.toFixed(6) : String(v)}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 text-xs font-semibold text-[var(--muted)]">{t("report.jitter_heuristics")}</h3>
        {d.stability_analysis.jitter_hypotheses.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">—</p>
        ) : (
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[var(--foreground)]">
            {d.stability_analysis.jitter_hypotheses.map((j) => (
              <li key={j.tag}>
                <span className="font-medium">[{j.tag}]</span> {j.user_visible}{" "}
                <span className="text-xs text-[var(--muted)]">({(j.confidence * 100).toFixed(0)}%)</span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/30 p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">{t("report.technical_details")}</summary>
          <p className="mb-2 mt-2 text-xs text-[var(--muted)]">{t("report.json_block")}</p>
          <pre className="max-h-72 overflow-x-auto overflow-y-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(d.stability_analysis, null, 2)}
          </pre>
        </details>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.pid")}</h2>
        <PidMiniTable current={d.pid_recommendation.current} proposed={d.pid_recommendation.proposed} labels={pidLabels} />
        {d.pid_recommendation.why.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--foreground)]">
            {d.pid_recommendation.why.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/30 p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">{t("report.technical_details")}</summary>
          <p className="mb-2 mt-2 text-xs text-[var(--muted)]">{t("report.json_block")}</p>
          <pre className="max-h-72 overflow-x-auto overflow-y-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(d.pid_recommendation, null, 2)}
          </pre>
        </details>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("report.actions")}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--foreground)]">
          {d.actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
      </section>

      <p className="text-xs leading-relaxed text-[var(--muted)]">{d.disclaimer}</p>
    </main>
  );
}
