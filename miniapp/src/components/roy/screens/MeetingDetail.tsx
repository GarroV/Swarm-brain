"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, RoyCard, Market, SectionLabel, IconBtn, PriDot, TezisyBlocks, Segmented } from "../ui";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "./RoyMeetingsScreen";
import { fetchMeeting, patchMeeting, deleteMeeting, fetchTasks } from "@/lib/api";
import type { Entry, Task } from "@/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

export function MeetingDetail({ id }: { id: string }) {
  const { pop, toast, openTask } = useRoyNav();
  const [e, setE] = useState<Entry | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchMeeting(id)
      .then(setE)
      .catch(() => setErr(true));
  }, [id]);

  useEffect(() => {
    load();
    fetchTasks()
      .then((ts) => setTasks(ts.filter((t) => t.meeting_id === id)))
      .catch(() => {});
  }, [id, load]);

  const confirmed = e ? e.metadata?.confirmed === true : false;
  // Куда сохранить при подтверждении: общая база команды (дефолт) или личное хранилище.
  const [storage, setStorage] = useState<"shared" | "personal">("shared");

  const confirm = async () => {
    setBusy(true);
    try {
      await patchMeeting(id, { confirmed: true, is_private: storage === "personal" });
      toast(storage === "personal" ? "Сохранено в личное" : "Сохранено в базу");
      load();
    } catch {
      toast("Не удалось");
    }
    setBusy(false);
  };
  const saveSummary = async () => {
    setBusy(true);
    try {
      const u = await patchMeeting(id, { summary: draft });
      setE(u);
      setEditing(false);
      toast("Тезисы обновлены");
    } catch {
      toast("Не удалось");
    }
    setBusy(false);
  };
  const del = async () => {
    setMenu(false);
    try {
      await deleteMeeting(id);
      toast("Встреча удалена");
      pop();
    } catch {
      toast("Не удалось удалить");
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Встреча" right={<IconBtn name="dots" aria-label="Действия" onClick={() => setMenu((v) => !v)} />} />
      {menu && (
        <>
          <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="roy-pop absolute right-4 top-14 z-50 flex gap-1 rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.18)]">
            <button type="button" aria-label="Изменить тезисы" onClick={() => { setMenu(false); setDraft(e?.summary ?? ""); setEditing(true); }} className="flex items-center justify-center rounded-[10px] p-2.5 transition-colors hover:bg-accent-soft active:scale-[0.94]" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={20} strokeWidth={1.9} />
            </button>
            <button type="button" aria-label="Удалить" onClick={del} className="flex items-center justify-center rounded-[10px] p-2.5 transition-colors active:scale-[0.94]" style={{ color: "var(--pri-high)" }}>
              <RoyIcon name="trash" size={20} strokeWidth={1.9} />
            </button>
          </div>
        </>
      )}
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {err && <div className="py-8 text-center text-sm text-ink-soft">Не удалось загрузить встречу.</div>}
        {e && (
          <>
            <div className="mb-2 flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ fontSize: 12, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 8, padding: "3px 9px" }}>
                <RoyIcon name="meet" size={12} strokeWidth={1.9} />
                {sourceLabel(e.source)}
              </span>
              <Market code={e.countries?.[0]} />
              {fmtDate(e.entry_date || e.created_at) && (
                <span className="text-ink-mute" style={{ fontSize: 12 }}>
                  {fmtDate(e.entry_date || e.created_at)}
                </span>
              )}
            </div>
            <h1 className="mb-4 font-bold text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              {deriveEntryTitle(e)}
            </h1>

            {editing ? (
              <div className="mb-4">
                <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={8} className="w-full resize-none rounded-[14px] border border-line-2 bg-surface px-4 py-3 text-ink outline-none focus:border-primary" style={{ fontSize: 14, lineHeight: 1.55 }} />
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={saveSummary} disabled={busy} className="flex-1 rounded-[12px] bg-primary py-2.5 font-semibold text-white disabled:opacity-60" style={{ fontSize: 14 }}>
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-[12px] border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : e.summary ? (
              <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 16 }}>
                <div className="mb-1.5 font-bold uppercase text-accent-ink" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
                  Кратко от ИИ
                </div>
                <TezisyBlocks text={e.summary} />
              </div>
            ) : null}

            {tasks.length > 0 && (
              <div className="mb-4">
                <SectionLabel>Задачи из встречи</SectionLabel>
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <button key={t.id} type="button" onClick={() => openTask(t)} className="w-full text-left transition-transform active:scale-[0.99]">
                      <RoyCard className="flex items-center gap-2 px-4 py-3">
                        <PriDot pri={(t.priority as "high" | "med" | "low" | null) ?? null} />
                        <span className="flex-1 truncate font-medium text-ink" style={{ fontSize: 14 }}>
                          {t.title}
                        </span>
                        <Market code={t.country} />
                      </RoyCard>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <SectionLabel>Запись</SectionLabel>
            <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
              {e.content}
            </p>
          </>
        )}
      </div>
      {e && !confirmed && !editing && (
        <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <div className="mb-2.5">
            <Segmented
              items={[
                { id: "shared", label: "Общее" },
                { id: "personal", label: "Личное" },
              ]}
              value={storage}
              onChange={(s) => setStorage(s as "shared" | "personal")}
            />
          </div>
          <button type="button" onClick={confirm} disabled={busy} className="w-full rounded-[14px] bg-primary py-3.5 font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
            {storage === "personal" ? "Сохранить в личное" : "Сохранить в базу"}
          </button>
        </div>
      )}
    </div>
  );
}
