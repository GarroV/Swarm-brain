import type { Metadata, Viewport } from "next";
import { Golos_Text, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SingleTabGate } from "@/components/SingleTabGate";

// Golos Text — весь UI, заголовки И метаданные (эталонная кириллица; дизайн-хендофф
// набирает мету тоже на Golos). JetBrains Mono оставлен только для технических
// таймстампов транскрипта в MeetingReview. Определяют CSS-переменные
// --font-sans / --font-geist-mono, которые ждёт @theme в globals.css.
const golos = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Рой",
  description: "База знаний, встречи и задачи команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Рой", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EB" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1714" },
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
          <SingleTabGate>{children}</SingleTabGate>
        </TelegramProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
