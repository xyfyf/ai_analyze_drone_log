"use client";

import { useMemo, useRef, useState } from "react";
import type { UserContext } from "@/lib/types/user-context";
import { AIRCRAFT_CLASS_VALUES } from "@/lib/constants/aircraft-types";
import { WHEELBASE_CUSTOM, WHEELBASE_PRESET_MM } from "@/lib/constants/wheelbase-presets";
import { useI18n } from "@/app/providers";
/**
 * 上传页：支持 .csv / .bin / .ulg；UserContext；文案与 API 随语言切换。
 */
export default function HomePage() {
  const { locale, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaultCtx = useMemo<Partial<UserContext>>(
    () => ({
      aircraft_class: "multicopter",
      fc_stack: "betaflight",
      cell_count: 6,
      prop_size_inch: 5,
      prop_blade_count: 3,
      motor_kv: 1950,
      takeoff_weight_g: 680,
    }),
    [],
  );

  const [ctx, setCtx] = useState<Partial<UserContext>>(defaultCtx);
  /** 轴距下拉：具体 mm、空字符串=未填、__custom__=自定义数值 */
  const [wheelbaseSelect, setWheelbaseSelect] = useState<string>("225");
  const [wheelbaseCustomMm, setWheelbaseCustomMm] = useState("");

  function resolveWheelbaseMm(): number | undefined {
    if (wheelbaseSelect === "") return undefined;
    if (wheelbaseSelect === WHEELBASE_CUSTOM) {
      const n = Number.parseFloat(wheelbaseCustomMm);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const n = Number.parseInt(wheelbaseSelect, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function pickLogFile(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const ok = name.endsWith(".csv") || name.endsWith(".bin") || name.endsWith(".ulg");
    if (!ok) {
      setErr(t("home.err_pick"));
      return;
    }
    setErr(null);
    setPickedFile(file);
    if (fileInputRef.current) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInputRef.current.files = dt.files;
      } catch {
        /* 部分浏览器对 DataTransfer 赋值受限，提交时仍可用 pickedFile */
      }
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const file = pickedFile ?? fileInputRef.current?.files?.[0];
    if (!file) {
      setErr(t("home.err_no_file"));
      return;
    }

    const userContext: UserContext = {
      aircraft_class: (ctx.aircraft_class ?? "multicopter") as UserContext["aircraft_class"],
      fc_stack: (ctx.fc_stack ?? "betaflight") as UserContext["fc_stack"],
      wheelbase_mm: resolveWheelbaseMm(),
      cell_count: ctx.cell_count,
      battery_mah: ctx.battery_mah,
      battery_brand_series: ctx.battery_brand_series,
      prop_size_inch: ctx.prop_size_inch,
      prop_blade_count: ctx.prop_blade_count,
      prop_brand_model: ctx.prop_brand_model,
      motor_kv: ctx.motor_kv,
      motor_model: ctx.motor_model,
      esc_protocol: ctx.esc_protocol,
      takeoff_weight_g: ctx.takeoff_weight_g,
      recent_changes: ctx.recent_changes,
      recent_param_diff: ctx.recent_param_diff,
      gyro_imu_hardware: ctx.gyro_imu_hardware,
      frame_material: ctx.frame_material,
      damping_notes: ctx.damping_notes,
      rx_link: ctx.rx_link,
      user_hypothesis: ctx.user_hypothesis,
    };

    const fd = new FormData();
    fd.append("file", file);
    fd.append("userContext", JSON.stringify(userContext));
    fd.append("locale", locale);

    setBusy(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "x-locale": locale },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("home.upload_fail"));
      window.location.href = `/report/${data.id}`;
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t("home.upload_fail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex max-w-4xl flex-col gap-12 px-4 pb-20 pt-8 sm:pt-12">
      <header className="space-y-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/60 bg-gradient-to-r from-orange-400/20 via-rose-400/15 to-amber-300/20 px-4 py-1.5 text-xs font-bold tracking-wide text-[var(--foreground)] shadow-sm backdrop-blur-md dark:border-white/10 dark:from-orange-500/15 dark:via-fuchsia-500/10 dark:to-amber-400/10">
            {t("home.hero_kicker")}
          </span>
          {[t("home.pill_step1"), t("home.pill_step2"), t("home.pill_step3")].map((pill, i) => (
            <span
              key={i}
              className="rounded-full border border-indigo-200/70 bg-indigo-500/[0.07] px-3.5 py-1 text-xs font-semibold text-indigo-900 dark:border-indigo-400/25 dark:bg-indigo-500/10 dark:text-indigo-100"
            >
              {pill}
            </span>
          ))}
        </div>
        <h1 className="hero-title-gradient max-w-3xl text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl">{t("home.hero_title")}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">{t("home.hero_lead")}</p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <code className="rounded-lg border border-[var(--border)] bg-white/70 px-2 py-1 font-mono text-[11px] shadow-sm dark:bg-white/5">
            DEEPSEEK_API_KEY
          </code>
          <span className="text-[var(--muted)]">/</span>
          <code className="rounded-lg border border-[var(--border)] bg-white/70 px-2 py-1 font-mono text-[11px] shadow-sm dark:bg-white/5">
            OPENAI_API_KEY
          </code>
          <span className="hidden sm:inline">—</span>
          <span className="w-full text-[11px] sm:w-auto">{t("home.api_key_hint")}</span>
        </p>
      </header>

      <form className="flex flex-col gap-8" onSubmit={onSubmit}>
        <input
          ref={fileInputRef}
          name="file"
          type="file"
          accept=".csv,.bin,.ulg,text/csv,application/octet-stream"
          className="sr-only"
          onChange={(e) => pickLogFile(e.target.files?.[0])}
        />

        <section className="rounded-[1.35rem] border border-white/60 bg-white/70 p-6 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-white/[0.06]">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 shadow-sm" aria-hidden />
            {t("home.card_upload_title")}
          </h2>
          <div
            className={`rounded-2xl bg-gradient-to-br p-[2px] transition-all duration-300 ${
              dragOver ? "from-fuchsia-500 via-orange-400 to-amber-400 shadow-lg" : "from-orange-300/60 via-indigo-300/50 to-cyan-300/50"
            }`}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickLogFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex w-full flex-col items-center justify-center gap-3 rounded-[14px] border border-transparent bg-white/92 px-4 py-14 text-sm transition-all dark:bg-slate-950/88 ${
                dragOver ? "scale-[1.01] shadow-inner" : "hover:bg-white dark:hover:bg-slate-900/95"
              }`}
            >
            <span className="text-[var(--foreground)]">
              {pickedFile ? (
                <>
                  {t("home.file_selected")}
                  <span className="font-mono font-medium">{pickedFile.name}</span>
                </>
              ) : (
                <>
                  {t("home.drag_before")}
                  <strong>.csv / .bin / .ulg</strong>
                  {t("home.drag_after")}
                </>
              )}
            </span>
            <span className="text-xs text-[var(--muted)]">{t("home.card_upload_sub")}</span>
            </button>
          </div>
        </section>

        <section className="rounded-[1.35rem] border border-white/60 bg-white/70 p-6 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-white/[0.06]">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-sm" aria-hidden />
            {t("home.card_context_title")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.platform_type")}</label>
              <select
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.aircraft_class}
                onChange={(e) =>
                  setCtx((c) => ({ ...c, aircraft_class: e.target.value as UserContext["aircraft_class"] }))
                }
              >
                {AIRCRAFT_CLASS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(`aircraft.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.fc_stack")}</label>
              <select
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.fc_stack}
                onChange={(e) => setCtx((c) => ({ ...c, fc_stack: e.target.value as UserContext["fc_stack"] }))}
              >
                <option value="betaflight">{t("home.fc_betaflight")}</option>
                <option value="ardupilot">{t("home.fc_ardupilot")}</option>
                <option value="px4">{t("home.fc_px4")}</option>
              </select>
              {ctx.fc_stack === "ardupilot" && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("home.fc_ardupilot_note")}</p>}
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.wheelbase_label")}</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55 sm:max-w-xs"
                  value={wheelbaseSelect}
                  onChange={(e) => setWheelbaseSelect(e.target.value)}
                >
                  <option value="">{t("home.wheelbase_unknown")}</option>
                  {WHEELBASE_PRESET_MM.map((mm) => (
                    <option key={mm} value={String(mm)}>
                      {mm} mm
                    </option>
                  ))}
                  <option value={WHEELBASE_CUSTOM}>{t("home.wheelbase_custom")}</option>
                </select>
                {wheelbaseSelect === WHEELBASE_CUSTOM && (
                  <input
                    type="number"
                    min={1}
                    placeholder={t("home.wheelbase_custom_ph")}
                    className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55 sm:flex-1"
                    value={wheelbaseCustomMm}
                    onChange={(e) => setWheelbaseCustomMm(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.cell_s")}</label>
              <input
                type="number"
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.cell_count ?? ""}
                onChange={(e) => setCtx((c) => ({ ...c, cell_count: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.prop_inch")}</label>
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.prop_size_inch ?? ""}
                onChange={(e) =>
                  setCtx((c) => ({ ...c, prop_size_inch: e.target.value ? Number(e.target.value) : undefined }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.motor_kv")}</label>
              <input
                type="number"
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.motor_kv ?? ""}
                onChange={(e) => setCtx((c) => ({ ...c, motor_kv: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.weight_g")}</label>
              <input
                type="number"
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                value={ctx.takeoff_weight_g ?? ""}
                onChange={(e) =>
                  setCtx((c) => ({ ...c, takeoff_weight_g: e.target.value ? Number(e.target.value) : undefined }))
                }
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.recent_changes")}</label>
              <textarea
                rows={3}
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                placeholder={t("home.recent_ph")}
                onChange={(e) => {
                  const lines = e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean);
                  const arr: NonNullable<UserContext["recent_changes"]> = [];
                  for (const l of lines) {
                    const [ty, ...rest] = l.split("|");
                    const description = rest.join("|").trim();
                    if (!description) continue;
                    if (ty === "hardware" || ty === "software" || ty === "tune") {
                      arr.push({ type: ty, description });
                    } else {
                      arr.push({ type: "hardware", description: l });
                    }
                  }
                  setCtx((c) => ({ ...c, recent_changes: arr.length ? arr : undefined }));
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">{t("home.user_hypothesis")}</label>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-sm shadow-sm backdrop-blur-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/25 dark:bg-slate-900/55"
                placeholder={t("home.user_hypothesis_ph")}
                onChange={(e) => setCtx((c) => ({ ...c, user_hypothesis: e.target.value || undefined }))}
              />
            </div>
          </div>
        </section>

        {err && (
          <p className="rounded-2xl border border-rose-300/60 bg-gradient-to-r from-rose-500/10 to-orange-500/10 px-5 py-4 text-sm font-medium text-rose-800 shadow-sm dark:border-rose-500/25 dark:from-rose-500/15 dark:to-orange-500/10 dark:text-rose-100">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:scale-[1.02] hover:shadow-xl active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
        >
          {busy ? t("home.btn_busy") : t("home.btn_submit")}
        </button>
      </form>
    </main>
  );
}
