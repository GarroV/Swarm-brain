import type { Metadata, Viewport } from "next";
import { Golos_Text, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SingleTabGate } from "@/components/SingleTabGate";
import { ConfirmProvider } from "@/components/ui/confirm";

// Golos Text — весь UI, заголовки И метаданные (эталонная кириллица). IBM Plex Mono — цифры
// и технические метки (сроки, счётчики, таймстампы): так набирает стенд редизайна
// (--font-num в docs/redesign/stand/app.css), до 24.09.2026 был JetBrains Mono. Определяют CSS-переменные
// --font-sans / --font-geist-mono, которые ждёт @theme в globals.css.
const golos = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Swarm Brain",
  description: "База знаний, встречи и задачи команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Swarm Brain", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1116" },
  ],
};

// Пре-гидрационный скрипт: тема следует за системой (prefers-color-scheme). Вешает/снимает
// класс `.dark` на <html> до первой отрисовки (без FOUC) и переключается вживую при смене
// темы ОС. В Telegram Mini App вебвью выставляет prefers-color-scheme под тему Telegram —
// поэтому отдельной интеграции с tg.colorScheme не требуется.
const THEME_SCRIPT = `!function(){try{var m=matchMedia("(prefers-color-scheme: dark)"),a=function(){document.documentElement.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)}catch(e){}}()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${golos.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TelegramProvider>
          <ConfirmProvider>
            <SingleTabGate>{children}</SingleTabGate>
          </ConfirmProvider>
        </TelegramProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
