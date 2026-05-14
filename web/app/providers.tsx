"use client";

import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppLocale } from "@/lib/i18n/translate";
import { translate } from "@/lib/i18n/translate";

type Messages = Record<string, unknown>;

type I18nValue = {
  locale: AppLocale;
  messages: Messages;
  t: (key: string, fallback?: string) => string;
  setLocale: (next: AppLocale) => void;
  pending: boolean;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * 根级 Client Provider：提供 t() 与语言切换（写 Cookie `locale` 后 refresh）。
 */
export function Providers({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: AppLocale;
  messages: Messages;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setLocale = useCallback(
    (next: AppLocale) => {
      document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`;
      startTransition(() => router.refresh());
    },
    [router],
  );

  const t = useCallback((key: string, fallback?: string) => translate(messages, key, fallback), [messages]);

  const value = useMemo(
    () => ({ locale, messages, t, setLocale, pending }),
    [locale, messages, t, setLocale, pending],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used within Providers");
  return v;
}
