"use client";
import { useEffect, useRef, useState } from "react";
import type { Task, TaskLink } from "@/types";
import { useDt } from "@/components/roy/nav";
import { CardIconBar } from "@/components/tasks/CardSectionMenu";
import { LinksMenu, TaskLinksList } from "@/components/tasks/TaskLinksField";
import {
  SubtasksMenu,
  TaskSubtasks,
  useTaskSubtasks,
} from "@/components/tasks/TaskSubtasks";
import {
  FileDropOverlay,
  FileInput,
  FilesMenu,
  TaskFilesSection,
} from "@/components/tasks/TaskFiles";
import { useTaskFiles } from "@/components/tasks/useTaskFiles";

// Разделы «Ссылки», «Подзадачи» и «Файлы» карточки задачи (TaskModal) — решение владельца
// 01.10.2026: «давай ссылки, файлы и подзадачи сделаем пиктограммами, но при этом
// с разворачивающимся контекстным меню. чтобы в задачах где это не требуется не занимать лишнее
// место в интерфейсе» (docs/decisions/2026-10-01-task-card-compact-sections.md).
//
// Пустой раздел не рисуется — его пиктограмма стоит в одной строке `bar`. Непустой рисуется
// заголовком и списком с «+» у заголовка, и его пиктограмма из строки уходит. Строка, разделы,
// оверлей броска файла и скрытый input собраны здесь, чтобы TaskModal только расставил их.

type Section = "links" | "subtasks" | "files";
/** Сколько ждать появления раздела после первого добавления, чтобы перевести фокус на его «+». */
const HANDOFF_MS = 4000;
/** Меню закрывается с анимацией ~100 мс и в её конце возвращает фокус — переводим после. */
const HANDOFF_SETTLE_MS = 200;

export function useCardSections(
  { task, isEdit, isPartial, links, setLinks, onSaved, onOpenTask }: {
    task: Task | null;
    isEdit: boolean;
    isPartial: boolean;
    links: TaskLink[];
    setLinks: (next: TaskLink[]) => void;
    onSaved?: () => void;
    onOpenTask?: (t: Task) => void;
  },
) {
  const dt = useDt();
  const editable = isEdit && !!task;
  const subs = useTaskSubtasks(editable && !isPartial ? task : null, onSaved);
  const files = useTaskFiles(editable ? task.id : null, task?.owner_id ?? null);

  // Первое добавление из строки пиктограмм убирает саму пиктограмму — фокус ушёл бы в никуда.
  // Переводим его на «+» появившегося раздела, как только тот отрисуется.
  const linksPlus = useRef<HTMLButtonElement>(null);
  const subtasksPlus = useRef<HTMLButtonElement>(null);
  const filesPlus = useRef<HTMLButtonElement>(null);
  const [handoff, setHandoff] = useState<Section | null>(null);
  useEffect(() => {
    if (!handoff) return;
    const ref = handoff === "links"
      ? linksPlus
      : handoff === "subtasks"
      ? subtasksPlus
      : filesPlus;
    const started = Date.now();
    // Ждём не только раздел, но и закрытие меню: поповер по закрытии сам возвращает фокус,
    // а раз его кнопки уже нет — уводит в начало карточки. Переводим фокус после него.
    const id = setInterval(() => {
      const waited = Date.now() - started;
      if (ref.current && waited >= HANDOFF_SETTLE_MS) {
        ref.current.focus();
        setHandoff(null);
      } else if (waited > HANDOFF_MS) {
        setHandoff(null);
      }
    }, 50);
    return () => clearInterval(id);
  }, [handoff]);

  const linksEmpty = links.length === 0;
  const showSubtasks = editable && !isPartial;
  const subsEmpty = showSubtasks && subs.empty;
  const filesEmpty = editable && files.empty;
  const filesReady = files.available && !!files.limits;

  const bar = (
    <CardIconBar label={dt("Добавить к задаче", "Add to the task")}>
      {linksEmpty && (
        <LinksMenu
          links={links}
          onChange={setLinks}
          disabled={isPartial}
          onDone={() => setHandoff("links")}
        />
      )}
      {filesEmpty && <FilesMenu f={files} onDone={() => setHandoff("files")} />}
      {subsEmpty && (
        <SubtasksMenu
          s={subs}
          onDone={() => setHandoff("subtasks")}
        />
      )}
    </CardIconBar>
  );

  // У недогруженной задачи ссылки только для чтения — отправлять их всё равно нельзя.
  const linksSection = (
    <TaskLinksList
      links={links}
      onChange={setLinks}
      disabled={isPartial}
      action={!isPartial && (
        <LinksMenu
          links={links}
          onChange={setLinks}
          variant="plus"
          triggerRef={linksPlus}
        />
      )}
    />
  );

  const subtasksSection = showSubtasks && task && subs.loaded && !subs.empty
    ? (
      <TaskSubtasks
        task={task}
        s={subs}
        onOpenTask={onOpenTask}
        // У подзадачи своих подзадач нет — «+» у строки «Подзадача задачи …» не нужен.
        action={!task.parent_id && (
          <SubtasksMenu s={subs} variant="plus" triggerRef={subtasksPlus} />
        )}
      />
    )
    : null;

  const filesSection = editable && files.loaded && !files.empty
    ? (
      <TaskFilesSection
        f={files}
        action={filesReady && (
          <FilesMenu f={files} variant="plus" triggerRef={filesPlus} />
        )}
      />
    )
    : null;

  return {
    bar,
    linksSection,
    subtasksSection,
    filesSection,
    /** Обработчики броска файла — на всю карточку: блока «Файлы» у пустой задачи больше нет. */
    dropProps: editable ? files.dropProps : {},
    dropOverlay: <FileDropOverlay show={files.dragging} />,
    fileInput: editable ? <FileInput f={files} /> : null,
  };
}
