"use client";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fetchMe } from "@/lib/api";
import { countryCode } from "@/lib/countries";
import { getInitData } from "@/lib/telegram";
import type { Me } from "@/types";
import {
  AccountSection, ClaudeDesktopSection, DigestSection, FeedbackSection, GoogleCalendarSection,
  GranolaSection, ProfileSection, RecorderSection, SettingsScreen, UploadSection,
} from "@/components/SettingsScreen";
import { ConnectorsSection } from "@/components/profile/ConnectorsSection";
import { TelegramPanel } from "@/components/profile/TelegramPanel";
import { BackdropSection } from "@/components/profile/BackdropSection";
import { useDt } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";

// «Настройки» десктопа по стенду (docs/redesign/stand/js/screens-system.js → screenSettings):
// одна страница, разделы подряд, в каждом строки «поле — значение — действие». Содержимое —
// прежние секции SettingsScreen, разложенные по разделам; действие строки раскрывает секцию под ней.
// Разделов стенда «Доступы», «Списки», «Роли задач» здесь нет: токены живут в карточках
// интеграций, списки задач правятся на доске задач, ролей задач в продукте нет. Строк «Язык»
// и «Тема» тоже нет — язык задаёт демо-режим, тема следует системе.

type Tab = "profile" | "integr" | "notif" | "more";
const SECTIONS: [Tab, string, string][] = [
  ["profile", "Профиль", "Profile"], ["integr", "Интеграции", "Integrations"],
  ["notif", "Дайджест", "Digest"], ["more", "Файлы и фидбек", "Files & feedback"],
];
const ROLE_LABEL: Record<string, string> = { bd: "BD", marketing: "Marketing", rnd: "R&D" };

/** Маршрут «Настройки»: на десктопе — одна страница по стенду, на мобайле — прежний экран. */
export function SettingsRoute() {
  return useIsDesktop() ? <SettingsDesk /> : <SettingsScreen />;
}

function SettingsDesk() {
  const dt = useDt();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchMe().then(setMe).catch((e) => { console.error("[SettingsDesk] me", e); setFailed(true); });
  }, []);

  // Одна страница, разделы подряд (решение владельца 2026-09-25: «настройки давай сделаем
  // ванпейджер. не будем разбивать») — вкладки прятали половину настроек за кликом.
  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-col gap-4 p-4" style={{ maxWidth: 1080 }}>
        {failed && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Профиль не загрузился — обновите страницу", "The profile failed to load — reload the page")}
          </p>
        )}
        {!failed && !me && <div className="roy-shim" style={{ height: 160, borderRadius: 10 }} />}
        {me && SECTIONS.map(([id, ru, en]) => (
          <section key={id} aria-labelledby={`settings-${id}`} className="rounded-[12px] border border-line bg-surface px-4 py-4">
            <h3 id={`settings-${id}`} className="mb-3 font-semibold text-ink" style={{ fontSize: 15 }}>{dt(ru, en)}</h3>
            <TabBody tab={id} me={me} onProfileSaved={(patch) => setMe({ ...me, ...patch })} />
          </section>
        ))}
      </div>
    </div>
  );
}

function TabBody({ tab, me, onProfileSaved }: { tab: Tab; me: Me; onProfileSaved: (patch: Pick<Me, "role" | "markets">) => void }) {
  const dt = useDt();
  if (tab === "integr") {
    return (
      <ConnectorsSection me={me} panels={{
        calendar: <GoogleCalendarSection />, recorder: <RecorderSection />, telegram: <TelegramPanel me={me} />,
        granola: <GranolaSection />, claude: <ClaudeDesktopSection />,
      }} />
    );
  }
  if (tab === "notif") {
    return (
      <Rows>
        <SettingRow label={dt("Дайджест", "Digest")} value={dt("период и охват для дайджеста; собрать сейчас", "period and scope; build one now")}
          action={dt("Настроить", "Set up")}>
          <DigestSection isAdmin={!!me.is_admin} />
        </SettingRow>
      </Rows>
    );
  }
  if (tab === "more") {
    return (
      <Rows>
        <SettingRow label={dt("Загрузить файл", "Upload a file")} value="PDF · XLSX · DOCX · TXT" action={dt("Выбрать", "Choose")}>
          <UploadSection />
        </SettingRow>
        <SettingRow label={dt("Фидбек", "Feedback")} value={dt("идея, баг или вопрос команде SWARM", "an idea, a bug or a question")}
          action={dt("Написать", "Write")}>
          <FeedbackSection />
        </SettingRow>
      </Rows>
    );
  }
  const role = me.role ? ROLE_LABEL[me.role] ?? me.role : null;
  const muted = (t: string) => <span className="text-ink-mute">{t}</span>;
  return (
    <Rows>
      <SettingRow label={dt("Имя", "Name")} value={<b className="text-ink">{me.name}</b>} />
      <SettingRow label={dt("Роль и рынки", "Role and markets")}
        value={[role, me.markets.map(countryCode).join(" ")].filter(Boolean).join(" · ") || muted(dt("не выбраны", "not set"))}
        action={dt("Изменить", "Edit")}>
        <ProfileSection me={me} onSaved={onProfileSaved} />
      </SettingRow>
      <SettingRow label="Telegram" value={me.username ? `@${me.username}` : muted(dt("без имени пользователя", "no username"))}
        action={dt("Подробнее", "Details")}>
        <TelegramPanel me={me} />
      </SettingRow>
      <SettingRow label={dt("Фон", "Background")} value={dt("картинка за экранами — ваша, коллеги её не видят", "the image behind screens — yours only")}
        action={dt("Настроить", "Set up")}>
        <BackdropSection />
      </SettingRow>
      {/* В браузере initData пустой → показываем выход; внутри Telegram — нет. */}
      {!getInitData() && (
        <SettingRow label={dt("Аккаунт", "Account")} value={dt("вход через Telegram", "signed in with Telegram")} action={dt("Выйти", "Sign out")}>
          <AccountSection />
        </SettingRow>
      )}
    </Rows>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[10px] border border-line">{children}</div>;
}

function SettingRow({ label, value, action, children }: {
  label: string; value: ReactNode; action?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="grid items-center gap-3 px-3" style={{ gridTemplateColumns: "220px minmax(0,1fr) auto", minHeight: 42, fontSize: 13 }}>
        <span className="text-ink-soft">{label}</span>
        <span className="min-w-0 truncate text-ink-soft">{value}</span>
        {action && children ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            className={cn(
              "inline-flex h-[28px] items-center rounded-[7px] border px-2.5 font-medium transition-colors",
              open ? "border-primary bg-accent-soft text-primary" : "border-line-2 bg-surface text-ink hover:bg-surface-2",
            )}
            style={{ fontSize: 12 }}>
            {action}
          </button>
        ) : <span />}
      </div>
      {open && children && <div className="border-t border-line bg-surface-2 px-4 py-3">{children}</div>}
    </div>
  );
}
