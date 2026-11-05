"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchAdminWorkspaces, patchAdminWorkspace } from "@/lib/api";
import type { AdminWorkspace } from "@/types";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";
import { useRoyNav } from "@/components/roy/nav";
import { canCreateWorkspace, canSeeMasterSection } from "@/lib/adminAccess";
import { takeAdminTarget } from "@/lib/adminTarget";
import { ModelUsagePanel } from "@/components/admin/ModelUsagePanel";
import { WorkspaceKeyPanel } from "@/components/admin/WorkspaceKeyPanel";
import { WorkspaceUsers } from "@/components/admin/WorkspaceUsers";
import { WorkspaceMarkets } from "@/components/admin/WorkspaceMarkets";
import { WorkspaceOverview, fmtUsd, useWorkspaceStats } from "@/components/admin/WorkspaceOverview";
import { WorkspaceReview } from "@/components/admin/WorkspaceReview";
import { WorkspaceBroadcast } from "@/components/admin/WorkspaceBroadcast";
import { SpaceCreate, spaceErrorKey } from "@/components/admin/SpaceCreate";
import { btnGhost, btnPrimary, fieldCls } from "@/components/admin/ui";
import { type SpacesKey, useSpacesText } from "@/components/admin/spacesText";

// «Пространства» админки (бывшие «Воркспейсы»): список → пространство со вкладками. Один вопрос
// экрана — «как живёт каждое пространство и кто в нём». Рассылка и очередь вычитки живут ВНУТРИ
// пространства (раньше были глобальными вкладками и смотрели на домашнее пространство админа);
// слаг пространства людям не показывается нигде — только название.

export type DetailTab = "overview" | "users" | "review" | "broadcast" | "markets" | "key" | "usage";
const DETAIL_TABS: Array<[DetailTab, SpacesKey]> = [
  ["overview", "tabOverview"], ["users", "tabPeople"], ["review", "tabReview"], ["broadcast", "tabBroadcast"],
  ["markets", "tabMarkets"], ["key", "tabKey"], ["usage", "tabSpend"],
];

/**
 * Открыть пространство сразу на нужной вкладке, если админку открыли с баннера сбоя ключа
 * (`setAdminTarget`). Цель одноразовая; нет такого пространства в списке — остаётся обычный экран.
 */
function useOpenFromTarget(onOpen: (ws: AdminWorkspace, tab: DetailTab) => void) {
  useEffect(() => {
    const target = takeAdminTarget();
    if (!target) return;
    fetchAdminWorkspaces().then((list) => {
      const ws = list.find((w) => w.id === target.ws);
      if (ws) onOpen(ws, target.tab);
    }).catch((e) => console.error("[admin] target", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- цель берётся один раз при монтировании
  }, []);
}

/** Раздел целиком: мастер-админу — список пространств; админу пространства — сразу его пространство. */
export function SpacesPanel({ desk = false, listFooter }: { desk?: boolean; listFooter?: React.ReactNode }) {
  const { me } = useRoyNav();
  const master = canSeeMasterSection(me);
  const [list, setList] = useState<AdminWorkspace[] | null>(null);
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);
  const [initialTab, setInitialTab] = useState<DetailTab>("overview");
  const [failed, setFailed] = useState(false);
  const t = useSpacesText();

  const load = useCallback(() => {
    setFailed(false);
    fetchAdminWorkspaces().then(setList).catch((e) => { console.error("[SpacesPanel]", e); setFailed(true); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useOpenFromTarget((ws, tab) => { setInitialTab(tab); setSelected(ws); });
  // Админ пространства видит одно — своё: список из одной строки лишний шаг.
  useEffect(() => { if (!master && !selected && list?.length === 1) setSelected(list[0]); }, [master, selected, list]);

  if (selected) {
    return (
      <SpaceDetail ws={selected} desk={desk} initialTab={initialTab} homeId={me?.group_id ?? null}
        onBack={master ? () => { setSelected(null); setInitialTab("overview"); load(); } : undefined}
        allWorkspaces={list ?? []} />
    );
  }
  if (failed) return <p className="px-4 py-6 text-ink-soft" style={{ fontSize: 13 }}>{t("loadFailed")}</p>;
  if (list === null) return <p className="px-4 py-6 text-ink-soft" style={{ fontSize: 13 }}>{t("loading")}</p>;
  return (
    <>
      <SpaceList list={list} desk={desk} homeId={me?.group_id ?? null} onSelect={setSelected} onCreated={(ws) => { load(); setSelected(ws); }} />
      {listFooter}
    </>
  );
}

// ── Список ─────────────────────────────────────────────────────────────────────
const LIST_COLS = "minmax(0,1.5fr) repeat(7, minmax(56px,0.5fr))";

function SpaceList({ list, desk, homeId, onSelect, onCreated }: {
  list: AdminWorkspace[]; desk: boolean; homeId: string | null;
  onSelect: (ws: AdminWorkspace) => void; onCreated: (ws: AdminWorkspace) => void;
}) {
  const { me } = useRoyNav();
  const t = useSpacesText();
  const [creating, setCreating] = useState(false);
  return (
    <div className={cn("space-y-2", desk ? "p-4" : "px-4")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>{t("listCount", { n: list.length })}</p>
        {canCreateWorkspace(me) && !creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="inline-flex h-[30px] items-center gap-1 rounded-full border border-line-2 bg-surface px-3 font-semibold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
            style={{ fontSize: 12.5 }}>
            <RoyIcon name="plus" size={14} strokeWidth={2.2} /> {t("newSpace")}
          </button>
        )}
      </div>
      {creating && <SpaceCreate onCancel={() => setCreating(false)} onCreated={(ws) => { setCreating(false); onCreated(ws); }} />}
      {list.length === 0 && !creating && (
        <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center text-ink-soft" style={{ fontSize: 13 }}>{t("listEmpty")}</div>
      )}
      {desk && list.length > 0 && (
        <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div role="row" className="grid items-center gap-2 border-b border-line bg-surface-2 px-3 font-semibold uppercase text-ink-soft"
            style={{ gridTemplateColumns: LIST_COLS, height: 32, fontSize: 10.5, letterSpacing: "0.05em" }}>
            <span>{t("colSpace")}</span>
            {(["stPeople", "stAdmins", "colActive", "stMeetings", "colSharedIn", "colTasks", "colSpend"] as const).map((k) => (
              <span key={k} className="truncate text-right">{t(k)}</span>
            ))}
          </div>
          {list.map((ws) => <DeskRow key={ws.id} ws={ws} home={ws.id === homeId} onSelect={onSelect} />)}
        </div>
      )}
      {!desk && list.map((ws) => <CardRow key={ws.id} ws={ws} home={ws.id === homeId} onSelect={onSelect} />)}
    </div>
  );
}

function HomeChip({ home }: { home: boolean }) {
  const t = useSpacesText();
  if (!home) return null;
  return <span className="shrink-0 rounded-[6px] px-1.5 py-0.5 font-semibold" style={{ fontSize: 10, color: "var(--accent-ink)", background: "var(--accent-soft)" }}>{t("yourSpace")}</span>;
}

const dash = "—";

function DeskRow({ ws, home, onSelect }: { ws: AdminWorkspace; home: boolean; onSelect: (ws: AdminWorkspace) => void }) {
  const { stats, failed } = useWorkspaceStats(ws.id);
  const cell = (v: string | number | undefined) => <span className="text-right font-mono text-ink-soft" style={{ fontSize: 12.5 }}>{failed ? dash : v ?? "…"}</span>;
  return (
    <button type="button" role="row" onClick={() => onSelect(ws)}
      className="grid w-full items-center gap-2 border-b border-line px-3 text-left transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      style={{ gridTemplateColumns: LIST_COLS, minHeight: 40, fontSize: 13 }}>
      <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold text-ink">{ws.name}</span><HomeChip home={home} /></span>
      {cell(stats?.people.total)}
      {cell(stats?.people.admins)}
      {cell(stats?.people.active)}
      {cell(stats?.meetings.home)}
      {cell(stats?.meetings.shared_in)}
      {cell(stats?.tasks_open)}
      {cell(stats ? fmtUsd(stats.model_spend_usd) : undefined)}
    </button>
  );
}

function CardRow({ ws, home, onSelect }: { ws: AdminWorkspace; home: boolean; onSelect: (ws: AdminWorkspace) => void }) {
  const t = useSpacesText();
  const { stats, failed } = useWorkspaceStats(ws.id);
  const bits = stats ? [
    t("cardPeople", { n: stats.people.total }), t("cardActive", { n: stats.people.active }), t("cardMeetings", { n: stats.meetings.home }),
    ...(stats.meetings.shared_in > 0 ? [t("cardSharedIn", { n: stats.meetings.shared_in })] : []),
    fmtUsd(stats.model_spend_usd),
  ] : [];
  return (
    <button type="button" onClick={() => onSelect(ws)}
      className="flex w-full flex-col gap-0.5 rounded-[10px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
      <span className="flex items-center gap-1.5"><span className="truncate font-bold text-ink" style={{ fontSize: 15 }}>{ws.name}</span><HomeChip home={home} /></span>
      <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
        {failed ? t("statsFailed") : stats ? bits.join(" · ") : t("loading")}
      </span>
    </button>
  );
}

// ── Пространство ───────────────────────────────────────────────────────────────
function SpaceDetail({ ws, desk, initialTab, homeId, onBack, allWorkspaces }: {
  ws: AdminWorkspace; desk: boolean; initialTab: DetailTab; homeId: string | null; onBack?: () => void; allWorkspaces: AdminWorkspace[];
}) {
  const t = useSpacesText();
  const [space, setSpace] = useState(ws);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveName = async () => {
    const name = draft.trim();
    if (!name || name === space.name) { setRenaming(false); setErr(null); return; }
    setSaving(true); setErr(null);
    try {
      const updated = await patchAdminWorkspace(space.id, { name });
      setSpace((w) => ({ ...w, name: updated?.name ?? name }));
      setRenaming(false);
    } catch (e) {
      console.error("[SpaceDetail] rename", e);
      setErr(t(spaceErrorKey(e)));
    } finally { setSaving(false); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t("back")} className="text-ink-soft transition-colors hover:text-ink">
            <RoyIcon name="cleft" size={20} strokeWidth={2.2} />
          </button>
        )}
        {renaming ? (
          <>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} autoFocus aria-label={t("renameLabel")}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setRenaming(false); setErr(null); } }}
              className={`${fieldCls} min-w-[160px] max-w-[320px] flex-1 font-bold`} style={{ fontSize: 16 }} />
            <button type="button" onClick={saveName} disabled={saving || !draft.trim()} className={btnPrimary} style={{ fontSize: 12.5, padding: "6px 14px" }}>{t("save")}</button>
            <button type="button" onClick={() => { setRenaming(false); setErr(null); }} className={btnGhost} style={{ fontSize: 12.5, padding: "6px 14px" }}>{t("cancel")}</button>
          </>
        ) : (
          <>
            <h1 className="truncate font-bold text-ink" style={{ fontSize: 20, letterSpacing: "-0.01em" }}>{space.name}</h1>
            <button type="button" onClick={() => { setDraft(space.name); setRenaming(true); }} aria-label={t("renameLabel")} className="transition-colors hover:opacity-80" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={16} strokeWidth={1.9} />
            </button>
            <HomeChip home={space.id === homeId} />
          </>
        )}
      </div>
      {err && <p role="alert" className="px-4 pb-1 font-semibold" style={{ fontSize: 12, color: "var(--pri-high)" }}>{err}</p>}

      <div role="tablist" className="flex shrink-0 items-end gap-5 overflow-x-auto border-b border-line px-4" style={{ height: 38 }}>
        {DETAIL_TABS.map(([id, key]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("-mb-px whitespace-nowrap border-b-2 pb-2 font-medium transition-colors",
              tab === id ? "border-primary font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink")}
            style={{ fontSize: 13 }}>
            {t(key)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "overview" && <WorkspaceOverview wsId={space.id} />}
        {tab === "users" && <WorkspaceUsers wsId={space.id} allWorkspaces={allWorkspaces} desk={desk} />}
        {tab === "review" && <WorkspaceReview wsId={space.id} />}
        {tab === "broadcast" && <WorkspaceBroadcast ws={space} />}
        {tab === "markets" && <WorkspaceMarkets ws={space} onUpdated={() => setSpace((w) => ({ ...w }))} />}
        {tab === "key" && <WorkspaceKeyPanel wsId={space.id} />}
        {tab === "usage" && <ModelUsagePanel workspaceId={space.id} />}
      </div>
    </div>
  );
}
