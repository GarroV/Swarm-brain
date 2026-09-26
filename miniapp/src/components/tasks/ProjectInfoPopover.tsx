"use client";

import { useEffect, useRef, useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { fetchUsers } from "@/lib/api";
import type { Project, ProjectLink, User } from "@/types";

/**
 * Справка «О проекте» — всплывашка у значка ⓘ справа от названия проекта на доске (просьба
 * владельца 27.09.2026: «инфа о том, что это за проект, зачем мы его ведём, нужные ссылки на
 * артефакты»). Всплывашка, а не модалка и не боковая панель — выбор владельца.
 *
 * Отдельным файлом: доска и так за 600 строк. Компонент ничего не пишет сам — правку отдаёт
 * наверх через onSave, проверку формы (http(s), пределы длины) делает сервер
 * (swarm-api/project-fields.ts), здесь только его текст отказа.
 */
type InfoFields = { goal: string | null; description: string | null; links: ProjectLink[] };

type Draft = { goal: string; description: string; links: ProjectLink[] };

/** Сводка по статусам: те же колонки, что на доске, — чтобы числа совпадали с тем, что видно. */
export type StatusCount = { label: string; count: number };

let usersCache: User[] | null = null;

export function ProjectInfoPopover({ project, stats, subprojectCount, onSave }: {
  project: Project;
  stats: StatusCount[];
  subprojectCount: number;
  onSave: (fields: InfoFields) => Promise<void>;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>(usersCache ?? []);
  const boxRef = useRef<HTMLDivElement>(null);

  // Клик мимо и Esc закрывают — тот же приём, что в MoveProjectMenu. Незаконченную правку не
  // закрываем кликом мимо: потерять набранный текст от промаха обиднее, чем нажать «Отмена».
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (draft) return;
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (draft) setDraft(null); else setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, draft]);

  // Ответственный хранится telegram id — имя подтягиваем один раз на всю доску.
  useEffect(() => {
    if (!open || usersCache || !project.owner_telegram_id) return;
    fetchUsers()
      .then((u) => { usersCache = u; setUsers(u); })
      .catch((e) => console.error("ProjectInfoPopover: fetchUsers failed", e));
  }, [open, project.owner_telegram_id]);

  const links = project.links ?? [];
  const ownerName = project.owner_telegram_id
    ? users.find((u) => u.telegram_id === project.owner_telegram_id)?.name ?? String(project.owner_telegram_id)
    : null;
  const period = [project.start_date, project.end_date].filter(Boolean).join(" → ");
  const isEmpty = !project.goal && !project.description && links.length === 0;

  function startEdit() {
    setErr(null);
    setDraft({
      goal: project.goal ?? "",
      description: project.description ?? "",
      links: links.length ? links : [{ title: "", url: "" }],
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true); setErr(null);
    try {
      await onSave({
        goal: draft.goal.trim() || null,
        description: draft.description.trim() || null,
        // Пустые строки формы — не ссылки: сервер отказал бы «у ссылки нет адреса».
        links: draft.links.filter((l) => l.url.trim()),
      });
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось сохранить", "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  const setLink = (i: number, patch: Partial<ProjectLink>) =>
    setDraft((d) => d && { ...d, links: d.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <div ref={boxRef} className="relative" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`rounded-full p-1 hover:bg-surface-2 ${open ? "text-primary" : "text-ink-soft"}`}
        title={dt("О проекте", "About the project")} aria-label={dt("О проекте", "About the project")} aria-expanded={open}>
        <RoyIcon name="info" size={14} strokeWidth={1.9} />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-auto rounded-xl border border-line bg-card p-3 text-left shadow-lg cursor-default select-text">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 truncate text-sm font-bold text-ink">{project.name}</span>
            {!draft && (
              <button type="button" onClick={startEdit} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Изменить", "Edit")}>
                <RoyIcon name="pencil" size={13} />
              </button>
            )}
            <button type="button" onClick={() => { setDraft(null); setOpen(false); }} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Закрыть", "Close")}>
              <RoyIcon name="x" size={13} />
            </button>
          </div>

          {draft ? (
            <div className="space-y-2.5">
              <Label text={dt("Зачем", "Why")} />
              <textarea value={draft.goal} rows={2} autoFocus
                onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                placeholder={dt("Зачем мы ведём этот проект", "Why we run this project")}
                className="w-full resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50" />
              <Label text={dt("Что это", "What it is")} />
              <textarea value={draft.description} rows={4}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={dt("Коротко о проекте: что делает, для кого", "What the project does and for whom")}
                className="w-full resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50" />
              <Label text={dt("Ссылки", "Links")} />
              {draft.links.map((l, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input value={l.title} onChange={(e) => setLink(i, { title: e.target.value })}
                    placeholder={dt("Название", "Title")}
                    className="w-[38%] rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-primary/50" />
                  <input value={l.url} onChange={(e) => setLink(i, { url: e.target.value })}
                    placeholder="https://…" inputMode="url"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-primary/50" />
                  <button type="button" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, j) => j !== i) })}
                    className="rounded-full p-1 text-ink-soft hover:bg-surface-2 hover:text-destructive" title={dt("Убрать ссылку", "Remove link")}>
                    <RoyIcon name="x" size={11} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setDraft({ ...draft, links: [...draft.links, { title: "", url: "" }] })}
                className="text-xs text-primary hover:underline">
                + {dt("ссылка", "link")}
              </button>
              {err && <p className="text-xs text-destructive">{err}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setDraft(null)} disabled={saving}
                  className="rounded-lg px-3 py-1 text-xs text-ink-soft hover:bg-surface-2">
                  {dt("Отмена", "Cancel")}
                </button>
                <button type="button" onClick={save} disabled={saving}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {saving ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {isEmpty && (
                <p className="text-ink-soft">
                  {dt("Справки пока нет. Нажмите карандаш — опишите, зачем проект и где его артефакты.",
                    "No description yet. Tap the pencil to add why the project exists and where its artifacts live.")}
                </p>
              )}
              {project.goal && <Section title={dt("Зачем", "Why")} text={project.goal} />}
              {project.description && <Section title={dt("Что это", "What it is")} text={project.description} />}
              {links.length > 0 && (
                <div>
                  <Label text={dt("Ссылки", "Links")} />
                  <ul className="mt-1 space-y-1">
                    {links.map((l, i) => (
                      <li key={i}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-primary hover:underline" title={l.url}>
                          <RoyIcon name="link" size={12} />
                          <span className="truncate">{l.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="border-t border-line pt-2 text-ink-soft space-y-1">
                {ownerName && <div>{dt("Ответственный", "Owner")}: <span className="text-ink">{ownerName}</span></div>}
                {period && <div>{dt("Сроки", "Dates")}: <span className="text-ink">{period}</span></div>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {stats.map((s) => (
                    <span key={s.label}>{s.label}: <span className="text-ink">{s.count}</span></span>
                  ))}
                  {subprojectCount > 0 && <span>{dt("Подпроектов", "Subprojects")}: <span className="text-ink">{subprojectCount}</span></span>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ text }: { text: string }) {
  return <div className="text-[11px] uppercase tracking-wide text-ink-soft">{text}</div>;
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <Label text={title} />
      <p className="mt-0.5 whitespace-pre-wrap text-ink">{text}</p>
    </div>
  );
}
