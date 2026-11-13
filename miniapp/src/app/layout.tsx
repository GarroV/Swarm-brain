import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible, Fraunces, Golos_Text, IBM_Plex_Mono, IBM_Plex_Sans, Inter_Tight, Manrope, Oswald,
  Sora, Source_Serif_4, Space_Grotesk,
} from "next/font/google";
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

// Golos Text — весь UI, заголовки И метаданные (эталонная кириллица). IBM Plex Mono — цифры
// и технические метки (сроки, счётчики, таймстампы): так набирает стенд редизайна
// (--font-num в docs/redesign/stand/app.css), до 24.09.2026 был JetBrains Mono. Определяют CSS-переменные
// --font-sans / --font-geist-mono, которые ждёт @theme в globals.css.
const golos = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-geist-mono", display: "swap" });

// Шрифты цветовых схем (lib/scheme.ts, app/schemes.css). preload:false — ни <link rel=preload>, ни
// загрузки файла, пока схема не вставит шрифт в стиль: у тех, кто схему не выбирал, трафик прежний
// (в сборке остаются лишь @font-face-правила с локальными файлами, браузер их не трогает без текста).
// next/font требует литеральных опций — display и preload повторены в каждом вызове.
// Кириллицу у Space Grotesk, Fraunces, Atkinson и Sora шрифт не даёт — буквы берутся из Golos Text
// (он следующий в стеке схемы).
const fSourceSerif = Source_Serif_4({ subsets: ["latin", "cyrillic"], variable: "--f-source-serif", display: "swap", preload: false });
const fOswald = Oswald({ subsets: ["latin", "cyrillic"], variable: "--f-oswald", display: "swap", preload: false });
const fSpaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--f-space-grotesk", display: "swap", preload: false });
const fFraunces = Fraunces({ subsets: ["latin"], variable: "--f-fraunces", display: "swap", preload: false });
const fAtkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-atkinson", display: "swap", preload: false });
const fManrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--f-manrope", display: "swap", preload: false });
const fSora = Sora({ subsets: ["latin"], variable: "--f-sora", display: "swap", preload: false });
const fPlexSans = IBM_Plex_Sans({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--f-plex-sans", display: "swap", preload: false });
const fInterTight = Inter_Tight({ subsets: ["latin", "cyrillic"], variable: "--f-inter-tight", display: "swap", preload: false });
const SCHEME_FONT_CLASSES = [
  fSourceSerif, fOswald, fSpaceGrotesk, fFraunces, fAtkinson, fManrope, fSora, fPlexSans, fInterTight,
].map((f) => f.variable).join(" ");

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
    <html lang="ru" className={`${golos.variable} ${mono.variable} ${SCHEME_FONT_CLASSES}`} suppressHydrationWarning>
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
