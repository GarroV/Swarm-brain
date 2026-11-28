import type { Metadata, Viewport } from "next";
import { interfaceFontVariables } from "../fonts/interface";
import "../fonts/fallbacks.css";
import "./globals.css";
import "./schemes.css";
import "./schemes-2.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SingleTabGate } from "@/components/SingleTabGate";
import { ConfirmProvider } from "@/components/ui/confirm";
import { BackdropLayer } from "@/components/roy/BackdropLayer";
import { BACKDROP_SCRIPT } from "@/lib/backdrop";
import { chunkRecoveryScript } from "@/lib/chunkRecovery";
import { schemeThemeScript } from "@/lib/scheme";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { PresencePulse } from "@/components/PresencePulse";

// Local licensed fonts retain the original Unicode faces, weights, fallback metrics and preload choices.
export const metadata: Metadata = {
  title: "Swarm Brain",
  description: "База знаний, встречи и задачи команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Swarm Brain", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#070A10" },
  ],
};

// Пре-гидрационный скрипт: режим — выбор из рейки (localStorage «swarm-theme», lib/theme.ts), без выбора —
// как в системе (prefers-color-scheme); цветовая схема — localStorage «swarm-scheme» (lib/scheme.ts).
// Ставит data-scheme и класс `.dark` на <html> до первой отрисовки (без FOUC) и переключается вживую
// при смене темы ОС. Схема с одним режимом навязывает его. В Telegram Mini App вебвью выставляет
// prefers-color-scheme под тему Telegram — отдельной интеграции с tg.colorScheme не требуется.
const THEME_SCRIPT = schemeThemeScript(THEME_STORAGE_KEY);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={interfaceFontVariables} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased min-h-screen">
        {/* Один инлайн-скрипт (CSP): тема по системе + задник из кэша до первой отрисовки. */}
        <script dangerouslySetInnerHTML={{ __html: `${chunkRecoveryScript(process.env.CF_PAGES_COMMIT_SHA ?? "unstamped")};${THEME_SCRIPT};${BACKDROP_SCRIPT}` }} />
        <BackdropLayer />
        {/* Заглушка работ — ВЫШЕ провайдеров: её должен увидеть и тот, у кого протухла
            сессия, иначе вместо «идут работы» он получит экран входа. */}
        <MaintenanceGate />
        <ConnectionBanner />
        {/* Пульс присутствия (#751): ничего не рисует, видно только админу через GET /presence. */}
        <PresencePulse />
        <ConfirmProvider>
          <SingleTabGate>{children}</SingleTabGate>
        </ConfirmProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
