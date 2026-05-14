import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getServerLocale } from "@/lib/i18n/server-locale";
import { messagesForLocale } from "@/lib/i18n/messages-for";
import { translate } from "@/lib/i18n/translate";
import { Providers } from "@/app/providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const dict = messagesForLocale(locale);
  return {
    title: translate(dict, "meta.title"),
    description: translate(dict, "meta.description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();
  const messages = messagesForLocale(locale);
  const htmlLang = locale === "en" ? "en" : "zh-CN";

  return (
    <html lang={htmlLang} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-[var(--foreground)]">
        <Providers locale={locale} messages={messages as Record<string, unknown>}>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
