import type { Metadata } from "next";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";

export const metadata: Metadata = {
  title: "Swarm Tasks",
  description: "Team task board",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased min-h-screen">
        <TelegramProvider>{children}</TelegramProvider>
      </body>
    </html>
  );
}
