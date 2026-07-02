"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, Market, SectionLabel, IconBtn, TezisyBlocks, Segmented } from "../ui";
import { DashTaskRow } from "../dash/shared";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "./RoyMeetingsScreen";
import { TasksFromMeeting } from "../TasksFromMeeting";
import { fetchMeeting, patchMeeting, deleteMeeting, fetchTasks, resummarizeMeetingEntry, fetchConfig } from "@/lib/api";
import { countryName } from "@/lib/countries";
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
  const { pop, toast, tasksVersion } = useRoyNav();
  const [e, setE] = useState<Entry | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [reproc, setReproc] = useState(false);
  const [editingCountries, setEditingCountries] = useState(false);
  const [selCountries, setSelCountries] = useState<string[]>([]);
  const [allowedMarkets, setAllowedMarkets] = useState<string[]>([]);

  // Переобработать тезисы текущим ИИ-промптом из транскрипта (доступно для встреч рекордера).
  const reprocess = async () => {
    if (reproc) return;
    setReproc(true);
    try {
      const u = await resummarizeMeetingEntry(id);
      setE(u);
      toast("Тезисы переобработаны");
    } catch {
      toast("Не удалось переобработать");
    } finally {
      setReproc(false);
    }
  };

  const load = useCallback(() => {
    fetchMeeting(id)
      .then(setE)
      .catch(() => setErr(true));
  }, [id]);

  const loadTasks = useCallback(() => {
    fetchTasks()
      .then((ts) => setTasks(ts.filter((t) => t.meeting_id === id)))
      .catch(() => {});
  }, [id, tasksVersion]);

  useEffect(() => {
    load();
    loadTasks();
  }, [id, load, loadTasks]);

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
  // Редактура стран встречи: мультивыбор рынков воркспейса (авто-теги часто неполные/неточные).
  const openCountriesEdit = async () => {
    setMenu(false);
    if (!allowedMarkets.length) {
      try { const c = await fetchConfig(); setAllowedMarkets(c.allowed_markets); } catch { /* оставим пустым */ }
    }
    setSelCountries((e?.countries ?? []).filter((c) => c !== "General"));
    setEditingCountries(true);
  };
  const toggleCountry = (code: string) =>
    setSelCountries((prev) => prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]);
  const saveCountries = async () => {
    setBusy(true);
    try {
      const u = await patchMeeting(id, { countries: selCountries });
      setE(u);
      setEditingCountries(false);
      toast("Страны обновлены");
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
            <button type="button" aria-label="Изменить страны" onClick={openCountriesEdit} className="flex items-center justify-center rounded-[10px] p-2.5 transition-colors hover:bg-accent-soft active:scale-[0.94]" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="globe" size={20} strokeWidth={1.9} />
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
              {(e.countries ?? []).filter((c) => c !== "General").map((c) => <Market key={c} code={c} />)}
              {fmtDate(e.entry_date || e.created_at) && (
                <span className="text-ink-mute" style={{ fontSize: 12 }}>
                  {fmtDate(e.entry_date || e.created_at)}
                </span>
              )}
            </div>
            <h1 className="mb-4 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {deriveEntryTitle(e)}
            </h1>

            {editingCountries && (
              <div className="mb-4 rounded-[14px] border border-line-2 bg-surface p-4">
                <SectionLabel>Страны встречи</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allowedMarkets.map((code) => {
                    const on = selCountries.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleCountry(code)}
                        className={`rounded-full border px-2.5 py-1 transition-colors ${on ? "bg-primary text-white border-primary" : "text-ink-soft border-line-2 hover:bg-surface-2"}`}
                        style={{ fontSize: 12 }}
                      >
                        {countryName(code)}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={saveCountries} disabled={busy} className="flex-1 rounded-[12px] bg-primary py-2.5 font-semibold text-white disabled:opacity-60" style={{ fontSize: 14 }}>
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setEditingCountries(false)} className="rounded-[12px] border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}

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
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-bold uppercase text-accent-ink" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
                    Кратко от ИИ
                  </span>
                  {Boolean(e.metadata?.meeting_id) && (
                    <button
                      type="button"
                      onClick={reprocess}
                      disabled={reproc}
                      title="Пересобрать тезисы текущим ИИ-промптом из транскрипта"
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-accent-line bg-card/60 font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
                      style={{ padding: "3px 9px", fontSize: 11 }}
                    >
                      <RoyIcon name="spark" size={12} strokeWidth={1.9} /> {reproc ? "Обрабатываю…" : "Переобработать"}
                    </button>
                  )}
                </div>
                <TezisyBlocks text={e.summary} />
              </div>
            ) : null}

            {e.content?.trim() && (
              <div className="mb-4">
                <TasksFromMeeting text={e.content} meetingId={e.id} resetKey={e.id} onAdded={loadTasks} />
                {tasks.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {tasks.map((t) => <DashTaskRow key={t.id} task={t} showAssignee />)}
                  </div>
                )}
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
