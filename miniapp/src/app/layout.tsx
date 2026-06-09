import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Рой — задачи",
  description: "Командные и личные задачи команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Рой", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="bg-background text-foreground antialiased min-h-screen">
        <TelegramProvider>{children}</TelegramProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
