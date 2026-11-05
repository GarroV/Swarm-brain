"use client";
import { useEffect, useState } from "react";
import { fetchWorkspaceStats, type WorkspaceStats } from "@/lib/api";
import { useSpacesText } from "@/components/admin/spacesText";
import { useLang } from "@/components/roy/nav";

// «Обзор» пространства: что в нём происходит, одними числами (GET /admin/workspaces/:id/stats).
// Вопрос экрана — «как живёт это пространство». Только счётчики: ни названий, ни текстов.

/** Сводка одного пространства; null — ещё грузится, undefined-ошибка не прячем в «0». */
export function useWorkspaceStats(wsId: string): { stats: WorkspaceStats | null; failed: boolean } {
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setStats(null); setFailed(false);
    fetchWorkspaceStats(wsId)
      .then((s) => { if (live) setStats(s); })
      .catch((e) => { console.error("[WorkspaceStats]", e); if (live) setFailed(true); });
    return () => { live = false; };
  }, [wsId]);
  return { stats, failed };
}

export const fmtUsd = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <p className="font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.07em" }}>{label}</p>
      <p className="font-semibold text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>{value}</p>
      {sub && <p className="text-ink-mute" style={{ fontSize: 11.5 }}>{sub}</p>}
    </div>
  );
}

export function WorkspaceOverview({ wsId }: { wsId: string }) {
  const t = useSpacesText();
  const lang = useLang();
  const { stats, failed } = useWorkspaceStats(wsId);

  if (failed) return <p className="text-ink-soft" style={{ fontSize: 13 }}>{t("statsFailed")}</p>;
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="roy-shim" style={{ height: 76, borderRadius: 10 }} />)}
      </div>
    );
  }
  const { people, meetings } = stats;
  const bot = stats.recorder_bot;
  const botText = !bot.configured ? t("botNotSet")
    : !bot.active ? t("botOff")
    : bot.last_seen_at ? t("botSeen", { when: new Date(bot.last_seen_at).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB") })
    : t("botOn");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={t("stPeople")} value={String(people.total)} sub={people.pending > 0 ? t("stPending", { n: people.pending }) : undefined} />
        <Tile label={t("stAdmins")} value={String(people.admins)} />
        <Tile label={t("stActive", { d: stats.window_days })} value={String(people.active)} sub={t("stOf", { n: people.total })} />
        <Tile label={t("stSpend", { d: stats.window_days })} value={fmtUsd(stats.model_spend_usd)} />
        <Tile label={t("stMeetings")} value={String(meetings.home)} />
        <Tile label={t("stSharedIn")} value={String(meetings.shared_in)} sub={t("stSharedInHint")} />
        <Tile label={t("stEntries")} value={String(stats.entries)} />
        <Tile label={t("stTasks")} value={String(stats.tasks_open)} />
      </div>
      <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
        <span className="font-semibold text-ink">{t("botLabel")}:</span> {botText}
      </p>
      <p className="text-ink-mute" style={{ fontSize: 11.5 }}>{t("statsNote", { d: stats.window_days })}</p>
    </div>
  );
}
