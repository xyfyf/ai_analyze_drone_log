"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/app/providers";

/**
 * 对话调参页：调用 /api/chat，展示带官网 citation 的回复（MVP）。
 */
export default function ChatPage() {
  const { locale, t } = useI18n();
  const [msg, setMsg] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [citations, setCitations] = useState<{ title: string; url: string; excerpt?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMsg(t("chat.sample_message"));
  }, [locale, t]);

  async function send() {
    setBusy(true);
    setOut(null);
    setCitations([]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-locale": locale },
        body: JSON.stringify({ message: msg, fc_stack: "betaflight" }),
      });
      const data = await res.json();
      setOut(data.reply ?? JSON.stringify(data));
      if (Array.isArray(data.citations)) setCitations(data.citations);
    } catch {
      setOut(t("chat.fail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <div>
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">
          ← {t("chat.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{t("chat.title")}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t("chat.subtitle")}</p>
      </div>
      <textarea
        className="min-h-32 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm shadow-[var(--card-shadow)]"
        placeholder={t("chat.placeholder")}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="w-fit rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {busy ? t("chat.busy") : t("chat.send")}
      </button>
      {out && (
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("chat.reply")}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">{out}</p>
        </section>
      )}
      {citations.length > 0 && (
        <section className="space-y-3 text-sm">
          <h2 className="font-semibold text-[var(--foreground)]">{t("chat.citations")}</h2>
          <ul className="list-disc space-y-3 pl-5 text-[var(--muted)]">
            {citations.map((c, i) => (
              <li key={i}>
                <a href={c.url} className="text-[var(--accent)] hover:underline" target="_blank" rel="noreferrer">
                  {c.title}
                </a>
                {c.excerpt && <div className="mt-1 text-xs leading-relaxed">{c.excerpt}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
