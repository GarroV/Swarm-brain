"use client";
import { useRoyNav } from "@/components/roy/nav";
import { canSeeMasterSection } from "@/lib/adminAccess";
import { MasterAdminsPanel } from "@/components/admin/MasterAdminsPanel";
import { SpacesPanel } from "@/components/admin/SpacesPanel";
import { useSpacesText } from "@/components/admin/spacesText";

// «Админ» на мобайле: пространства (список или сразу своё) и, мастер-админу, список мастер-админов.
// Очередь вычитки и рассылка — внутри пространства (SpacesPanel), не отдельными блоками.
// Десктоп — AdminDesk (вкладки по стенду), тот же SpacesPanel.
export function AdminScreen() {
  const { me } = useRoyNav();
  const t = useSpacesText();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-5 pb-1">
        <h1 className="font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{me?.is_superadmin ? t("titleMaster") : t("titleAdmin")}</h1>
        <p className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em", marginTop: 2 }}>{t("subtitle")}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
        <SpacesPanel listFooter={canSeeMasterSection(me) ? <div className="mt-3 px-4"><MasterAdminsPanel /></div> : undefined} />
      </div>
    </div>
  );
}
