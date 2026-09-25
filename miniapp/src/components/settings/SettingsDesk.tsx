"use client";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fetchMe } from "@/lib/api";
import { countryCode } from "@/lib/countries";
import { getInitData } from "@/lib/telegram";
import type { Me } from "@/types";
import {
  AccountSection, ClaudeDesktopSection, DigestSection, GoogleCalendarSection,
  GranolaSection, ProfileSection, RecorderSection, SettingsScreen,
} from "@/components/SettingsScreen";
import { ConnectorsSection } from "@/components/profile/ConnectorsSection";
import { TelegramPanel } from "@/components/profile/TelegramPanel";
import { BackdropSection } from "@/components/profile/BackdropSection";
import { useDt } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";

// «Настройки» десктопа — компактное бенто (решение владельца 2026-09-25: «сделать очень компактный
// бенто, а не пытаться разнести все по всему экрану»): «Профиль» на две трети, рядом плитки «Фон» и
// «Дайджест», ниже интеграции одной строкой. Содержимое — прежние секции SettingsScreen: действие
// строки открывает одну панель ПОД бенто (а не раздувает плитку), повторное нажатие — закрывает.
// Раздела «Файлы и фидбек» нет (решение владельца 2026-09-25: «файлы никто не добавляет»;
// фидбек — плавающая кнопка). Разделов стенда «Доступы», «Списки», «Роли задач» здесь нет: токены живут в карточках
// интеграций, списки задач правятся на доске задач, ролей задач в продукте нет. Строки «Язык»
// нет — язык задаёт демо-режим; тема переключается в рейке над «Настройками» (lib/theme.ts).

const ROLE_LABEL: Record<string, string> = { bd: "BD", marketing: "Marketing", rnd: "R&D" };

type Panel = "role" | "telegram" | "backdrop" | "account" | "digest";
const PANEL_TITLE: Record<Panel, [string, string]> = {
  role: ["Роль и рынки", "Role and markets"], telegram: ["Telegram", "Telegram"],
  backdrop: ["Фон", "Background"], account: ["Аккаунт", "Account"], digest: ["Дайджест", "Digest"],
};

/** Маршрут «Настройки»: на десктопе — бенто, на мобайле — прежний экран. */
export function SettingsRoute() {
  return useIsDesktop() ? <SettingsDesk /> : <SettingsScreen />;
}

function SettingsDesk() {
  const dt = useDt();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    fetchMe().then(setMe).catch((e) => { console.error("[SettingsDesk] me", e); setFailed(true); });
  }, []);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-col gap-3 p-4" style={{ maxWidth: 880 }}>
        {failed && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Профиль не загрузился — обновите страницу", "The profile failed to load — reload the page")}
          </p>
        )}
        {!failed && !me && <div className="roy-shim" style={{ height: 160, borderRadius: 10 }} />}
        {me && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <ProfileTile me={me} open={panel} onToggle={toggle} />
              <div className="flex flex-col gap-3">
                <Tile title={dt("Фон", "Background")}>
                  <Hint>{dt("картинка за экранами — видите только вы", "the image behind screens — yours only")}</Hint>
                  <Action on={panel === "backdrop"} onClick={() => toggle("backdrop")}>{dt("Настроить", "Set up")}</Action>
                </Tile>
                <Tile title={dt("Дайджест", "Digest")}>
                  <Hint>{dt("период и охват; собрать сейчас", "period and scope; build one now")}</Hint>
                  <Action on={panel === "digest"} onClick={() => toggle("digest")}>{dt("Настроить", "Set up")}</Action>
                </Tile>
              </div>
              <Tile title={dt("Интеграции", "Integrations")} className="col-span-3">
                <ConnectorsSection me={me} dense panels={{
                  calendar: <GoogleCalendarSection />, recorder: <RecorderSection />, telegram: <TelegramPanel me={me} />,
                  granola: <GranolaSection />, claude: <ClaudeDesktopSection />,
                }} />
              </Tile>
            </div>
            {panel && (
              <section aria-label={dt(...PANEL_TITLE[panel])} className="rounded-[12px] border border-accent-line bg-surface px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt(...PANEL_TITLE[panel])}</h3>
                  <button type="button" onClick={() => setPanel(null)} className="text-ink-mute hover:text-ink" style={{ fontSize: 12 }}>
                    {dt("Закрыть", "Close")}
                  </button>
                </div>
                <PanelBody panel={panel} me={me} onProfileSaved={(patch) => setMe({ ...me, ...patch })} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProfileTile({ me, open, onToggle }: { me: Me; open: Panel | null; onToggle: (p: Panel) => void }) {
  const dt = useDt();
  const role = me.role ? ROLE_LABEL[me.role] ?? me.role : null;
  const roleMarkets = [role, me.markets.map(countryCode).join(" ")].filter(Boolean).join(" · ");
  return (
    <Tile title={dt("Профиль", "Profile")} className="col-span-2">
      <p className="truncate font-semibold text-ink" style={{ fontSize: 15 }}>{me.name}</p>
      <div className="mt-2 flex flex-col">
        <Line label={dt("Роль и рынки", "Role and markets")} value={roleMarkets || dt("не выбраны", "not set")} muted={!roleMarkets}>
          <Action on={open === "role"} onClick={() => onToggle("role")}>{dt("Изменить", "Edit")}</Action>
        </Line>
        <Line label="Telegram" value={me.username ? `@${me.username}` : dt("без имени пользователя", "no username")} muted={!me.username}>
          <Action on={open === "telegram"} onClick={() => onToggle("telegram")}>{dt("Подробнее", "Details")}</Action>
        </Line>
        {/* В браузере initData пустой → показываем выход; внутри Telegram — нет. */}
        {!getInitData() && (
          <Line label={dt("Аккаунт", "Account")} value={dt("вход через Telegram", "signed in with Telegram")}>
            <Action on={open === "account"} onClick={() => onToggle("account")}>{dt("Выйти", "Sign out")}</Action>
          </Line>
        )}
      </div>
    </Tile>
  );
}

function PanelBody({ panel, me, onProfileSaved }: { panel: Panel; me: Me; onProfileSaved: (patch: Pick<Me, "role" | "markets">) => void }) {
  switch (panel) {
    case "role": return <ProfileSection me={me} onSaved={onProfileSaved} />;
    case "telegram": return <TelegramPanel me={me} />;
    case "backdrop": return <BackdropSection />;
    case "account": return <AccountSection />;
    case "digest": return <DigestSection isAdmin={!!me.is_admin} />;
  }
}

function Tile({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col rounded-[12px] border border-line bg-surface px-3.5 py-3", className)}>
      <h3 className="mb-1.5 uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.1em", fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mb-2 flex-1 text-ink-soft" style={{ fontSize: 12 }}>{children}</p>;
}

function Line({ label, value, muted, children }: { label: string; value: string; muted?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-1.5" style={{ fontSize: 12.5 }}>
      <span className="w-[110px] shrink-0 text-ink-mute">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", muted ? "text-ink-mute" : "text-ink")}>{value}</span>
      {children}
    </div>
  );
}

function Action({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={on} onClick={onClick}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center self-start rounded-[7px] border px-2.5 font-medium transition-colors",
        on ? "border-primary bg-accent-soft text-primary" : "border-line-2 bg-surface text-ink hover:bg-surface-2",
      )}
      style={{ fontSize: 12 }}>
      {children}
    </button>
  );
}
