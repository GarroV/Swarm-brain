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
  themeColor: "#F4F1EB",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${golos.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <TelegramProvider>
          <SingleTabGate>{children}</SingleTabGate>
        </TelegramProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
