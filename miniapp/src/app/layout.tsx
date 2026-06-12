import type { Metadata, Viewport } from "next";
import { Golos_Text, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// Golos Text — весь UI и заголовки (эталонная кириллица). JetBrains Mono — метаданные
// (даты, таймстампы, коды рынков). Определяют CSS-переменные --font-sans / --font-geist-mono,
// которые ждёт @theme в globals.css. Это чинит «серифный Times» (раньше переменные не были заданы).
const golos = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Рой",
  description: "База знаний, встречи и задачи команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Рой", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f8f7f5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${golos.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <TelegramProvider>{children}</TelegramProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
