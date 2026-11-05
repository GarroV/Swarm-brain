"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AdminScreen } from "@/components/AdminScreen";
import { useRoyNav } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { MasterAdminsPanel } from "@/components/admin/MasterAdminsPanel";
import { canSeeMasterSection } from "@/lib/adminAccess";
import { ModelUsagePanel } from "@/components/admin/ModelUsagePanel";
import { SpacesPanel } from "@/components/admin/SpacesPanel";
import { type SpacesKey, useSpacesText } from "@/components/admin/spacesText";

// «Админ» десктопа по стенду (docs/redesign/stand/js/screens-system.js → screenAdmin): вкладки
// Пространства · Расход модели (мастер-админу, #311) · Мастер-админы (мастер-админу, #233).
// Очередь вычитки и рассылка — не вкладки, а разделы ВНУТРИ пространства (SpacesPanel): они
// относятся к конкретной команде, и мастер-админ выбирает, какую (этап 4 «Второго пространства»).
// Вкладок стенда «Пользователи» (все люди разом), «Встречи от агента» и «Фидбек» здесь нет: людей
// продукт показывает по пространству, черновики агента разбираются на экране «Встречи», списка
// фидбека в вебе нет (он приходит админу в Telegram).

type Tab = "spaces" | "usage" | "masters";
const TABS: [Tab, SpacesKey][] = [["spaces", "tabSpaces"], ["usage", "tabModelSpend"], ["masters", "tabMasters"]];
// Вкладки, видимые только мастер-админу (`me.is_superadmin`).
const SUPERADMIN_TABS: Tab[] = ["usage", "masters"];

/** Маршрут «Админ»: на десктопе — вкладки по стенду, на мобайле — прежний экран. */
export function AdminRoute() {
  return useIsDesktop() ? <AdminDesk /> : <AdminScreen />;
}

function AdminDesk() {
  const t = useSpacesText();
  const { me } = useRoyNav();
  const [tab, setTab] = useState<Tab>("spaces");
  // Повторный клик по «Пространства» возвращает к списку: меняем key — панель собирается заново.
  const [spacesKey, setSpacesKey] = useState(0);
  const tabs = TABS.filter(([id]) => !SUPERADMIN_TABS.includes(id) || canSeeMasterSection(me));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {tabs.length > 1 && (
        <div role="tablist" className="flex shrink-0 items-end gap-5 overflow-x-auto border-b border-line px-5" style={{ height: 40 }}>
          {tabs.map(([id, key]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              onClick={() => { setTab(id); if (id === "spaces") setSpacesKey((k) => k + 1); }}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 font-medium transition-colors",
                tab === id ? "border-primary font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink",
              )}
              style={{ fontSize: 13 }}>
              {t(key)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tab === "spaces" && <SpacesPanel key={spacesKey} desk />}
        {tab === "usage" && canSeeMasterSection(me) && <ModelUsagePanel />}
        {tab === "masters" && canSeeMasterSection(me) && <div className="p-4"><MasterAdminsPanel /></div>}
      </div>
    </div>
  );
}
