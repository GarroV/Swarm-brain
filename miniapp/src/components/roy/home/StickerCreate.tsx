"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDt } from "../nav";
import { useDialogA11y } from "./useDialogA11y";
import { PAPER, SWATCH } from "./stickerUi";
import { createSticker, fetchPeople } from "@/lib/api";
import { dueInputToIso, groupRecipients, STICKER_BODY_MAX, STICKER_TITLE_MAX, STICKER_TONES } from "@/lib/stickers";
import type { Person, StickerKind, StickerTone } from "@/types";

// Форма нового стикера (только админ). Создание НИКОМУ ничего не отправляет: адресаты увидят
// стикер на главной, а у задания появится задача. Слова об этом — прямо в форме.

const SHOWN = 60;
const FIELD = "w-full rounded-lg border border-line-2 bg-surface px-2.5 py-1.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function StickerCreate({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const dt = useDt();
  const ref = useRef<HTMLFormElement>(null);
  useDialogA11y(ref, onClose);

  const [kind, setKind] = useState<StickerKind>("task");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [tone, setTone] = useState<StickerTone>("yellow");
  const [link, setLink] = useState("");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPeople().then((p) => { if (alive) setPeople(p); }).catch(() => { if (alive) setPeopleFailed(true); });
    return () => { alive = false; };
  }, []);

  const { users, guests } = useMemo(() => groupRecipients(people ?? [], query), [people, query]);
  const [guestsOpen, setGuestsOpen] = useState(false);
  // Поиск раскрывает группу «Без входа» сам, пока в ней есть совпадения.
  const showGuests = guestsOpen || (query.trim().length > 0 && guests.length > 0);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const canSubmit = title.trim().length > 0 && (all || picked.size > 0) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createSticker({
        kind, title: title.trim(), body: body.trim(), due_at: dueInputToIso(due), tone,
        link: link.trim() || null, all, person_ids: all ? [] : [...picked],
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : dt("Не получилось", "Something went wrong"));
      setBusy(false);
    }
  };

  const row = (p: Person, guest: boolean) => (
    <li key={p.id}>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
        <span>{p.name}</span>
        {guest && p.email && <span className="truncate text-ink-mute" style={{ fontSize: 11 }}>{p.email}</span>}
      </label>
    </li>
  );

  const seg = (on: boolean) => `flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${on ? "bg-primary text-primary-foreground" : "text-ink-soft hover:bg-surface-2"}`;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sticker-create-title"
        tabIndex={-1}
        onSubmit={submit}
        className="flex max-h-[90vh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-xl outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 id="sticker-create-title" className="font-semibold" style={{ fontSize: 18 }}>{dt("Новый стикер", "New sticker")}</h2>
          <button type="button" onClick={onClose} aria-label={dt("Закрыть", "Close")} className="rounded-md px-2 py-0.5 text-[20px] leading-none text-ink-soft hover:bg-surface-2">×</button>
        </div>

        <div role="radiogroup" aria-label={dt("Тип стикера", "Sticker type")} className="flex gap-1 rounded-lg border border-line bg-surface p-1" style={{ fontSize: 13 }}>
          <button type="button" role="radio" aria-checked={kind === "task"} onClick={() => setKind("task")} className={seg(kind === "task")}>{dt("Задание", "Task")}</button>
          <button type="button" role="radio" aria-checked={kind === "notice"} onClick={() => setKind("notice")} className={seg(kind === "notice")}>{dt("Объявление", "Notice")}</button>
        </div>
        <p className="text-ink-mute" style={{ fontSize: 12 }}>
          {kind === "task"
            ? dt("Каждому адресату появится задача со сроком и описанием. Сообщений никому не отправляется.", "Every addressee gets a task with the due date and description. No messages are sent to anyone.")
            : dt("Адресаты увидят объявление на главной и отметят «Понятно». Сообщений никому не отправляется.", "Addressees see the notice on the home page and mark “Got it”. No messages are sent to anyone.")}
        </p>

        <label className="flex flex-col gap-1" style={{ fontSize: 13 }}>
          <span className="font-medium">{dt("Заголовок", "Title")}</span>
          <input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={STICKER_TITLE_MAX} required className={FIELD} />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 13 }}>
          <span className="font-medium">{dt("Описание", "Description")}</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={STICKER_BODY_MAX} rows={3} className={FIELD} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1" style={{ fontSize: 13 }}>
            <span className="font-medium">{dt("Срок", "Due")} <span className="font-normal text-ink-mute">{dt("(необязательно)", "(optional)")}</span></span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1" style={{ fontSize: 13 }}>
            <span className="font-medium">{dt("Ссылка", "Link")} <span className="font-normal text-ink-mute">{dt("(необязательно)", "(optional)")}</span></span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" className={FIELD} />
          </label>
        </div>

        <div role="radiogroup" aria-label={dt("Цвет", "Colour")} className="flex items-center gap-2" style={{ fontSize: 13 }}>
          <span className="font-medium">{dt("Цвет", "Colour")}</span>
          {STICKER_TONES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tone === t}
              aria-label={t}
              onClick={() => setTone(t)}
              className={`h-7 w-7 rounded-[3px] border shadow-sm ${PAPER[t]} ${tone === t ? "border-2 border-[#1B1B1B] ring-2 ring-[var(--ring)]" : "border-black/20"}`}
              style={{ background: SWATCH[t] }}
            />
          ))}
        </div>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 font-medium" style={{ fontSize: 13 }}>{dt("Кому", "Addressees")}</legend>
          <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {dt("Все в воркспейсе (у кого есть вход)", "Everyone in the workspace (with an account)")}
          </label>
          {!all && (
            <>
              <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={dt("Найти человека", "Find a person")} placeholder={dt("Имя или почта", "Name or email")} className={FIELD} style={{ fontSize: 13 }} />
              {peopleFailed && <p className="text-[var(--pri-high)]" style={{ fontSize: 12 }}>{dt("Список людей не загрузился", "Couldn't load people")}</p>}
              {people == null && !peopleFailed && <div className="roy-shim" style={{ height: 60, borderRadius: 8 }} />}
              <div className="max-h-[220px] overflow-y-auto" style={{ fontSize: 13 }}>
                <p className="px-1.5 pb-0.5 font-medium text-ink-soft" style={{ fontSize: 12 }}>{dt("Пользователи", "Users")} · {users.length}</p>
                <ul>
                  {users.slice(0, SHOWN).map((p) => row(p, false))}
                  {people != null && users.length === 0 && <li className="px-1.5 py-1 text-ink-mute">{dt("Никого не найдено", "No one found")}</li>}
                  {users.length > SHOWN && <li className="px-1.5 py-1 text-ink-mute" style={{ fontSize: 11 }}>{dt("Уточните поиск, чтобы увидеть остальных", "Refine the search to see more")}</li>}
                </ul>
                {guests.length > 0 && (
                  <div className="mt-2 border-t border-line pt-2">
                    <button type="button" aria-expanded={showGuests} onClick={() => setGuestsOpen((v) => !v)} className="flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left font-medium text-ink-soft hover:bg-surface-2" style={{ fontSize: 12 }}>
                      <span aria-hidden>{showGuests ? "▾" : "▸"}</span>
                      {dt("Без входа", "No login")} · {guests.length}
                    </button>
                    <p className="px-1.5 text-ink-mute" style={{ fontSize: 11 }}>
                      {dt("Люди из встреч, не участники проекта: стикер на главной они не увидят.", "People from meetings, not project members: they won't see the sticker on the home page.")}
                    </p>
                    {showGuests && (
                      <ul>
                        {guests.slice(0, SHOWN).map((p) => row(p, true))}
                        {guests.length > SHOWN && <li className="px-1.5 py-1 text-ink-mute" style={{ fontSize: 11 }}>{dt("Уточните поиск, чтобы увидеть остальных", "Refine the search to see more")}</li>}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <p className="text-ink-mute" style={{ fontSize: 12 }}>{dt(`Выбрано: ${picked.size}`, `Selected: ${picked.size}`)}</p>
            </>
          )}
        </fieldset>

        {error && <p role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--pri-high)_14%,transparent)] px-3 py-2 text-[var(--pri-high)]" style={{ fontSize: 13 }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line-2 px-3 py-1.5 text-ink-soft hover:bg-surface-2" style={{ fontSize: 13 }}>{dt("Отмена", "Cancel")}</button>
          <button type="submit" disabled={!canSubmit} className="rounded-lg bg-primary px-4 py-1.5 font-medium text-primary-foreground disabled:opacity-50" style={{ fontSize: 13 }}>
            {busy ? dt("Создаём…", "Creating…") : dt("Создать", "Create")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
