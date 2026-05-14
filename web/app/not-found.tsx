import Link from "next/link";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { messagesForLocale } from "@/lib/i18n/messages-for";
import { translate } from "@/lib/i18n/translate";

export default async function NotFound() {
  const locale = await getServerLocale();
  const dict = messagesForLocale(locale);
  const t = (k: string) => translate(dict, k);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-24 text-center">
      <p className="text-6xl font-bold text-[var(--muted)]">404</p>
      <h1 className="text-xl font-semibold text-[var(--foreground)]">{t("notFound.title")}</h1>
      <Link
        href="/"
        className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
      >
        {t("notFound.back")}
      </Link>
    </main>
  );
}
