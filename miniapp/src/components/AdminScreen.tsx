"use client";
import { useRoyNav } from "@/components/roy/nav";
import { canSeeMasterSection } from "@/lib/adminAccess";
import { MasterAdminsPanel } from "@/components/admin/MasterAdminsPanel";
import { ModelUsagePanel } from "@/components/admin/ModelUsagePanel";
import { SpacesPanel } from "@/components/admin/SpacesPanel";
import { useSpacesText } from "@/components/admin/spacesText";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// «Админ» на мобайле: пространства и, мастер-админу, существующий расход модели (#837).
// Список мастер-админов остаётся в списке пространств.
// Очередь вычитки и рассылка — внутри пространства (SpacesPanel), не отдельными блоками.
// Десктоп — AdminDesk (вкладки по стенду), тот же SpacesPanel.
export function AdminScreen() {
  const { me } = useRoyNav();
  const t = useSpacesText();
  const master = canSeeMasterSection(me);
  const spaces = <SpacesPanel listFooter={master ? <div className="mt-3 px-4"><MasterAdminsPanel /></div> : undefined} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-5 pb-1">
        <h1 className="font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{me?.is_superadmin ? t("titleMaster") : t("titleAdmin")}</h1>
        <p className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em", marginTop: 2 }}>{t("subtitle")}</p>
      </div>
      {master ? (
        <Tabs defaultValue="spaces" className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="h-10 w-full justify-start gap-5 border-b border-line px-4">
            <TabsTrigger value="spaces">{t("tabSpaces")}</TabsTrigger>
            <TabsTrigger value="usage">{t("tabModelSpend")}</TabsTrigger>
          </TabsList>
          <TabsContent value="spaces" className="min-h-0 overflow-y-auto pb-4">{spaces}</TabsContent>
          <TabsContent value="usage" className="min-h-0 overflow-y-auto pb-4"><ModelUsagePanel /></TabsContent>
        </Tabs>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">{spaces}</div>
      )}
    </div>
  );
}
