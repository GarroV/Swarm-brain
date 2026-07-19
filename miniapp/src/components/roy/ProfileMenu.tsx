"use client";
import { useEffect, useState } from "react";
import { useRoyNav, useDt } from "./nav";
import { Avatar, Segmented } from "./ui";
import { RoyIcon } from "./icons";
import { initials } from "./dash/shared";
import { displayName } from "@/lib/utils";
import { SettingsScreen } from "@/components/SettingsScreen";
import { TeamScreen } from "@/components/TeamScreen";
import { AdminScreen } from "@/components/AdminScreen";

type Tab = "settings" | "team" | "admin";

// Кнопка «Ещё» (десктоп, нижний левый угол) + НАТИВНЫЙ ПОПОВЕР прямо там же:
// профиль/настройки/команда/админ менеджерятся inline, без перехода на отдельную
// страницу. Поповер «вырастает» из кнопки вверх; закрытие по клику-вне или Esc.
export function ProfileMenu() {
  const { me } = useRoyNav();
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("settings");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const tabs = [
    { id: "settings", label: dt("Настройки", "Settings") },
    { id: "team", label: dt("Команда", "Team") },
    ...(me?.is_admin ? [{ id: "admin", label: dt("Админ", "Admin") }] : []),
  ];

  return (
    <div className="absolute bottom-3 left-3 z-40">
      {open && (
        <>
          {/* клик-вне закрывает */}
          <button type="button" aria-label={dt("Закрыть меню", "Close menu")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          {/* Единый размер для всех вкладок: фиксированная ширина + ФИКСИРОВАННАЯ высота
              (h, не max-h), чтобы окно не «прыгало» при переключении Настройки/Команда/Админ
              и под-видов (список ↔ деталь, Пользователи ↔ Рынки). Контент скроллится внутри —
              все экраны построены как flex min-h-0 flex-1 + overflow-y-auto. */}
          <div
            role="dialog"
            aria-label={dt("Профиль и управление", "Profile & management")}
            className="absolute bottom-full left-0 z-50 mb-2 flex w-[520px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[20px] border border-line bg-[var(--popover)] shadow-[0_24px_64px_-18px_rgba(0,0,0,.5)] dark:backdrop-blur-xl"
            style={{ height: "min(680px, 86vh)" }}
          >
            {/* шапка: профиль + закрыть */}
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar size={36}>{initials(me?.name)}</Avatar>
                <div className="min-w-0">
                  <div className="truncate font-bold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
                    {displayName(me?.name) || dt("Профиль", "Profile")}
                  </div>
                  <div className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>
                    {me?.is_admin ? dt("Админ", "Admin") : dt("Участник", "Member")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={dt("Закрыть", "Close")}
                className="flex items-center justify-center rounded-[10px] p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RoyIcon name="x" size={18} />
              </button>
            </div>

            {/* переключатель секций */}
            <div className="shrink-0 px-3 pt-3">
              <Segmented items={tabs} value={tab} onChange={(v) => setTab(v as Tab)} />
            </div>

            {/* контент секции — inline, со своим скроллом */}
            <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden">
              {tab === "settings" && <SettingsScreen />}
              {tab === "team" && <TeamScreen />}
              {tab === "admin" && me?.is_admin && <AdminScreen />}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={dt("Профиль и настройки", "Profile & settings")}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 shadow-[0_4px_14px_-8px_rgba(60,45,20,.4)] transition-colors hover:bg-surface-2 active:scale-[0.97] dark:backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Avatar size={28}>{initials(me?.name)}</Avatar>
        <span className="font-semibold text-ink-soft" style={{ fontSize: 13 }}>{dt("Ещё", "More")}</span>
      </button>
    </div>
  );
}
