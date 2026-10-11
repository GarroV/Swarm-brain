"use client";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDt, useRoyNav } from "@/components/roy/nav";
import {
  ApiError,
  fetchTaskFiles,
  removeTaskFile,
  taskFileUrl,
  UploadAbortedError,
  uploadTaskFile,
} from "@/lib/api";
import {
  formatSize,
  type RejectReason,
  splitPicked,
  type TaskFile,
  type TaskFileLimits,
} from "@/lib/taskFiles";

// Состояние и действия блока «Файлы» (#638), вынесенные из TaskFiles.tsx 01.10.2026: карточке
// нужно знать, пуст ли раздел, ещё до его отрисовки — пустой раздел не рисуется, от него остаётся
// пиктограмма со скрепкой (docs/decisions/2026-10-01-task-card-compact-sections.md). Логика
// загрузки, лимиты и хранилище не менялись — это перенос, а не переписывание.

export type Uploading = {
  key: string;
  name: string;
  size: number;
  share: number;
  ctrl: AbortController;
  error?: string;
};
export type Rejected = { key: string; name: string; reason: RejectReason };
export type TaskFilesState = ReturnType<typeof useTaskFiles>;

export function useTaskFiles(
  taskId: string | null,
  /** Автор задачи (created_by_telegram_id): вправе убрать любой файл карточки. */
  taskCreatorId: number | null,
) {
  const dt = useDt();
  const { me, toast } = useRoyNav();
  const [files, setFiles] = useState<TaskFile[] | null>(null);
  const [limits, setLimits] = useState<TaskFileLimits | null>(null);
  const [available, setAvailable] = useState(true);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    // Другая задача в той же карточке (переход к подзадаче) — старый список не показываем.
    setFiles(null);
    setRejected([]);
    fetchTaskFiles(taskId)
      .then((r) => {
        if (!alive) return;
        setFiles(r.files);
        setLimits(r.limits);
        setAvailable(r.available);
      })
      .catch(() => {
        if (alive) setFiles([]);
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  const patchUpload = (key: string, patch: Partial<Uploading>) =>
    setUploads((cur) =>
      cur.map((u) => (u.key === key ? { ...u, ...patch } : u))
    );

  const startUpload = useCallback((id: string, file: File) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    const ctrl = new AbortController();
    setUploads((
      cur,
    ) => [...cur, { key, name: file.name, size: file.size, share: 0, ctrl }]);
    uploadTaskFile(
      id,
      file,
      (share) => patchUpload(key, { share }),
      ctrl.signal,
    )
      .then((saved) => {
        setFiles((cur) => [...(cur ?? []), saved]);
        setUploads((cur) => cur.filter((u) => u.key !== key));
      })
      .catch((e) => {
        if (e instanceof UploadAbortedError) {
          setUploads((cur) => cur.filter((u) => u.key !== key));
          return;
        }
        const offline = e instanceof ApiError &&
          (e.status === 0 || e.status === 502 || e.status === 503);
        patchUpload(key, {
          error: offline
            ? dt(
              "Хранилище файлов сейчас недоступно",
              "File storage is unreachable right now",
            )
            : e instanceof ApiError && e.status === 403
            ? dt(
              "В демо файлы не загружаются",
              "File uploads are disabled in the demo",
            )
            : e instanceof ApiError && e.status === 429
            ? dt(
              "Слишком много незавершённых загрузок за сутки — попробуйте позже",
              "Too many unfinished uploads today — try again later",
            )
            : e instanceof ApiError && e.message && e.status === 400
            ? e.message
            : dt(
              "Не загрузилось — попробуйте ещё раз",
              "Upload failed — try again",
            ),
        });
      });
  }, [dt]);

  const pick = (list: FileList | File[]) => {
    if (!limits || !taskId) return;
    const busy = (files?.length ?? 0) + uploads.filter((u) => !u.error).length;
    const { ok, rejected: bad } = splitPicked([...list], limits, busy);
    setRejected(
      bad.map((b) => ({
        key: `${b.file.name}-${Math.random()}`,
        name: b.file.name,
        reason: b.reason,
      })),
    );
    ok.forEach((file) => startUpload(taskId, file));
  };

  const open = async (f: TaskFile) => {
    if (!taskId) return;
    // Окно открываем сразу, в том же клике: после await браузер счёл бы его всплывающим и закрыл.
    const win = f.inline ? globalThis.open("", "_blank") : null;
    try {
      const url = await taskFileUrl(taskId, f.id);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        a.click();
      }
    } catch {
      win?.close();
      toast(
        dt(
          "Файл сейчас недоступен — хранилище не отвечает",
          "The file is unavailable — storage isn't responding",
        ),
      );
    }
  };

  const remove = async (f: TaskFile) => {
    if (!taskId) return;
    const before = files;
    setFiles((cur) => (cur ?? []).filter((x) => x.id !== f.id));
    try {
      await removeTaskFile(taskId, f.id);
    } catch {
      setFiles(before);
      toast(dt("Не удалось убрать файл", "Couldn't remove the file"));
    }
  };

  const cancelUpload = (u: Uploading) =>
    u.error
      ? setUploads((cur) => cur.filter((x) => x.key !== u.key))
      : u.ctrl.abort();

  const canRemove = (f: TaskFile) =>
    !!me &&
    (me.is_admin || f.uploaded_by === me.telegram_id ||
      taskCreatorId === me.telegram_id);

  const onDrag = (e: DragEvent, delta: 1 | -1 | 0) => {
    if (!e.dataTransfer.types.includes("Files") || !available || !limits) {
      return;
    }
    e.preventDefault();
    if (delta !== 0) {
      dragDepth.current = Math.max(0, dragDepth.current + delta);
      setDragging(dragDepth.current > 0);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (available) pick(e.dataTransfer.files);
  };
  /** Обработчики броска файла — вешаются на всю карточку, а не только на блок «Файлы». */
  const dropProps = {
    onDragEnter: (e: DragEvent) => onDrag(e, 1),
    onDragOver: (e: DragEvent) => onDrag(e, 0),
    onDragLeave: (e: DragEvent) => onDrag(e, -1),
    onDrop,
  };

  const count = files?.length ?? 0;
  const full = !!limits &&
    count + uploads.filter((u) => !u.error).length >= limits.maxFiles;
  const limitText = limits
    ? dt(
      `до ${formatSize(limits.maxBytes)} каждый · до ${limits.maxFiles} файлов`,
      `up to ${
        formatSize(limits.maxBytes, true)
      } each · up to ${limits.maxFiles} files`,
    )
    : "";
  const reasonText = (r: RejectReason) =>
    r === "too_big"
      ? dt(
        `больше ${formatSize(limits?.maxBytes ?? 0)}`,
        `larger than ${formatSize(limits?.maxBytes ?? 0, true)}`,
      )
      : r === "type"
      ? dt(
        "такой тип не принимаем — видео и программы нельзя",
        "this type isn't accepted — no video or programs",
      )
      : r === "empty"
      ? dt("файл пустой", "the file is empty")
      : dt(
        `у задачи уже ${limits?.maxFiles} файлов`,
        `the task already has ${limits?.maxFiles} files`,
      );

  return {
    files,
    limits,
    available,
    uploads,
    rejected,
    dismissRejected: () => setRejected([]),
    dragging,
    dropProps,
    inputRef,
    choose: () => inputRef.current?.click(),
    pick,
    open,
    remove,
    cancelUpload,
    canRemove,
    count,
    full,
    limitText,
    reasonText,
    // Пуст — загружено, хранилище на месте и показывать нечего. Пока список грузится, нет ни
    // раздела, ни пиктограммы: иначе скрепка мелькнула бы и исчезла у задачи с файлами.
    // Недоступное хранилище — не «пусто»: раздел остаётся и говорит об этом вслух.
    empty: files !== null && available && !!limits && count === 0 &&
      uploads.length === 0 && rejected.length === 0,
    loaded: files !== null,
  };
}
