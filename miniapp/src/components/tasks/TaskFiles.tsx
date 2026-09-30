"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { cn } from "@/lib/utils";
import {
  ApiError,
  fetchTaskFiles,
  removeTaskFile,
  taskFileUrl,
  uploadTaskFile,
  UploadAbortedError,
} from "@/lib/api";
import {
  fileExt,
  fileKind,
  formatSize,
  splitPicked,
  type FileKind,
  type RejectReason,
  type TaskFile,
  type TaskFileLimits,
} from "@/lib/taskFiles";

// Файлы к задаче (#638, решение владельца 2026-09-30: «не забудь проработать визуал. это важно»).
// Блок живёт в карточке задачи (TaskModal и экран TaskDetail) рядом с подзадачами и комментариями.
// Лимит показывается честно, до выбора файла: «до 50 МБ · до 10 файлов» — цифры приходят с сервера,
// и отказ по размеру или типу звучит сразу, а не после минуты загрузки. Байты лежат на MUSPELHEIM:
// если он недоступен, блок говорит об этом, а не делает вид, что файлов нет.

const KIND_ICON: Record<FileKind, RoyIconName> = {
  pdf: "pdf", image: "image", sheet: "board", slides: "graph", doc: "doc", archive: "clip", other: "doc",
};

type Uploading = { key: string; name: string; size: number; share: number; ctrl: AbortController; error?: string };
type Rejected = { key: string; name: string; reason: RejectReason };

function useLoc() {
  const dt = useDt();
  const en = dt("ru", "en") === "en";
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" });
  return { dt, en, date };
}

export function TaskFiles({ taskId, taskOwnerId }: { taskId: string; taskOwnerId: number | null }) {
  const { dt, en, date } = useLoc();
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
    let alive = true;
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
    return () => { alive = false; };
  }, [taskId]);

  const patchUpload = (key: string, patch: Partial<Uploading>) =>
    setUploads((cur) => cur.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  const startUpload = useCallback((file: File) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    const ctrl = new AbortController();
    setUploads((cur) => [...cur, { key, name: file.name, size: file.size, share: 0, ctrl }]);
    uploadTaskFile(taskId, file, (share) => patchUpload(key, { share }), ctrl.signal)
      .then((saved) => {
        setFiles((cur) => [...(cur ?? []), saved]);
        setUploads((cur) => cur.filter((u) => u.key !== key));
      })
      .catch((e) => {
        if (e instanceof UploadAbortedError) {
          setUploads((cur) => cur.filter((u) => u.key !== key));
          return;
        }
        const offline = e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503);
        patchUpload(key, {
          error: offline
            ? dt("Хранилище файлов сейчас недоступно", "File storage is unreachable right now")
            : e instanceof ApiError && e.status === 403
            ? dt("В демо файлы не загружаются", "File uploads are disabled in the demo")
            : e instanceof ApiError && e.status === 429
            ? dt("Слишком много незавершённых загрузок за сутки — попробуйте позже", "Too many unfinished uploads today — try again later")
            : e instanceof ApiError && e.message && e.status === 400
            ? e.message
            : dt("Не загрузилось — попробуйте ещё раз", "Upload failed — try again"),
        });
      });
  }, [taskId, dt]);

  const pick = (list: FileList | File[]) => {
    if (!limits) return;
    const busy = (files?.length ?? 0) + uploads.filter((u) => !u.error).length;
    const { ok, rejected: bad } = splitPicked([...list], limits, busy);
    setRejected(bad.map((b) => ({ key: `${b.file.name}-${Math.random()}`, name: b.file.name, reason: b.reason })));
    ok.forEach(startUpload);
  };

  const open = async (f: TaskFile) => {
    // Окно открываем сразу, в том же клике: после await браузер счёл бы его всплывающим и закрыл.
    const win = f.inline ? window.open("", "_blank") : null;
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
      toast(dt("Файл сейчас недоступен — хранилище не отвечает", "The file is unavailable — storage isn't responding"));
    }
  };

  const remove = async (f: TaskFile) => {
    const before = files;
    setFiles((cur) => (cur ?? []).filter((x) => x.id !== f.id));
    try {
      await removeTaskFile(taskId, f.id);
    } catch {
      setFiles(before);
      toast(dt("Не удалось убрать файл", "Couldn't remove the file"));
    }
  };

  const canRemove = (f: TaskFile) =>
    !!me && (me.is_admin || f.uploaded_by === me.telegram_id || taskOwnerId === me.telegram_id);

  const onDrag = (e: DragEvent, delta: 1 | -1 | 0) => {
    if (!e.dataTransfer.types.includes("Files") || !available) return;
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

  const count = files?.length ?? 0;
  const full = !!limits && count + uploads.filter((u) => !u.error).length >= limits.maxFiles;
  const limitText = limits
    ? dt(
      `до ${formatSize(limits.maxBytes)} каждый · до ${limits.maxFiles} файлов`,
      `up to ${formatSize(limits.maxBytes, true)} each · up to ${limits.maxFiles} files`,
    )
    : "";
  const reasonText = (r: RejectReason) =>
    r === "too_big"
      ? dt(`больше ${formatSize(limits?.maxBytes ?? 0)}`, `larger than ${formatSize(limits?.maxBytes ?? 0, true)}`)
      : r === "type"
      ? dt("такой тип не принимаем — видео и программы нельзя", "this type isn't accepted — no video or programs")
      : r === "empty"
      ? dt("файл пустой", "the file is empty")
      : dt(`у задачи уже ${limits?.maxFiles} файлов`, `the task already has ${limits?.maxFiles} files`);

  return (
    <div
      className="relative"
      onDragEnter={(e) => onDrag(e, 1)}
      onDragOver={(e) => onDrag(e, 0)}
      onDragLeave={(e) => onDrag(e, -1)}
      onDrop={onDrop}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-semibold text-ink" style={{ fontSize: 13 }}>{dt("Файлы", "Files")}</span>
        {count > 0 && <span className="font-mono text-ink-mute" style={{ fontSize: 11.5 }}>{count}</span>}
        {available && limits && (
          <button
            type="button"
            disabled={full}
            onClick={() => inputRef.current?.click()}
            title={full ? reasonText("too_many") : limitText}
            className="ml-auto inline-flex items-center gap-1 rounded-[7px] px-2 py-1 font-medium text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-ink-mute"
            style={{ fontSize: 12.5 }}
          >
            <RoyIcon name="clip" size={14} strokeWidth={1.8} />
            {dt("Прикрепить", "Attach")}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={limits?.accept.map((x) => `.${x}`).join(",")}
          onChange={(e) => {
            if (e.target.files) pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files === null && <div className="roy-shim" style={{ height: 40, borderRadius: 8 }} />}

      {!available && files !== null && (
        <p className="flex items-center gap-1.5 rounded-[8px] bg-surface-2 px-3 py-2 text-ink-soft" style={{ fontSize: 12.5 }}>
          <RoyIcon name="warn" size={14} strokeWidth={1.8} className="shrink-0" />
          {dt(
            "Хранилище файлов сейчас недоступно — файлы появятся, когда оно вернётся",
            "File storage is unreachable right now — files will show up once it's back",
          )}
        </p>
      )}

      {(count > 0 || uploads.length > 0) && (
        <ul className="overflow-hidden rounded-[10px] border border-line">
          {(files ?? []).map((f) => (
            <FileRow key={f.id} file={f} en={en} date={date} canRemove={canRemove(f)} onOpen={() => open(f)} onRemove={() => remove(f)} />
          ))}
          {uploads.map((u) => (
            <UploadRow key={u.key} u={u} en={en}
              onCancel={() => (u.error ? setUploads((cur) => cur.filter((x) => x.key !== u.key)) : u.ctrl.abort())} />
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <div role="status" className="mt-2 rounded-[8px] border border-line bg-surface-2 px-3 py-2" style={{ fontSize: 12.5 }}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              {rejected.map((r) => (
                <p key={r.key} className="text-ink-soft">
                  <span className="font-medium text-ink">{r.name}</span> — {reasonText(r.reason)}
                </p>
              ))}
            </div>
            <button type="button" onClick={() => setRejected([])} aria-label={dt("Скрыть", "Dismiss")}
              className="shrink-0 rounded p-0.5 text-ink-mute hover:bg-surface hover:text-ink">
              <RoyIcon name="x" size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {available && limits && (
        <button
          type="button"
          disabled={full}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-2 px-3 text-ink-mute transition-colors",
            "hover:border-primary/50 hover:text-ink-soft disabled:cursor-not-allowed disabled:hover:border-line-2 disabled:hover:text-ink-mute",
            count > 0 ? "py-2" : "py-4",
          )}
          style={{ fontSize: 12.5 }}
        >
          <RoyIcon name="upload" size={15} strokeWidth={1.8} className="shrink-0" />
          <span>
            <span className="hidden lg:inline">{dt("Перетащите файлы сюда или ", "Drop files here or ")}</span>
            <span className="hidden font-medium text-primary lg:inline">{dt("выберите", "choose")}</span>
            <span className="font-medium text-primary lg:hidden">{dt("Выбрать файлы", "Choose files")}</span>
            <span className="text-ink-mute"> · {limitText}</span>
          </span>
        </button>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border-2 border-dashed border-primary bg-background/85 backdrop-blur-[2px]">
          <span className="inline-flex items-center gap-2 font-semibold text-primary" style={{ fontSize: 13.5 }}>
            <RoyIcon name="upload" size={16} strokeWidth={2} />
            {dt("Отпустите — прикрепим к задаче", "Drop to attach to the task")}
          </span>
        </div>
      )}
    </div>
  );
}

function KindBadge({ name }: { name: string }) {
  const kind = fileKind(name);
  const ext = fileExt(name).slice(0, 4).toUpperCase() || "FILE";
  return (
    <span className={cn(
      "flex size-9 shrink-0 flex-col items-center justify-center rounded-[8px] border",
      kind === "pdf" ? "border-accent-line bg-accent-soft text-accent-ink" : "border-line bg-surface-2 text-ink-soft",
    )}>
      <RoyIcon name={KIND_ICON[kind]} size={14} strokeWidth={1.7} />
      <span className="font-mono font-semibold leading-none" style={{ fontSize: 8.5, marginTop: 2 }}>{ext}</span>
    </span>
  );
}

function FileRow({ file, en, date, canRemove, onOpen, onRemove }: {
  file: TaskFile;
  en: boolean;
  date: (iso: string) => string;
  canRemove: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const dt = useDt();
  const meta = [formatSize(file.size, en), file.uploaded_by_name, date(file.created_at)].filter(Boolean).join(" · ");
  return (
    <li className="group flex items-center gap-2.5 border-b border-line px-2.5 py-2 last:border-b-0 hover:bg-surface-2/60">
      <KindBadge name={file.name} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left"
        title={file.inline ? dt("Открыть", "Open") : dt("Скачать", "Download")}>
        <span className="block truncate font-medium text-ink group-hover:text-primary" style={{ fontSize: 13.5 }}>{file.name}</span>
        <span className="block truncate text-ink-mute" style={{ fontSize: 11.5 }}>{meta}</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
        <IconBtn icon="download" label={dt("Скачать", "Download")} onClick={onOpen} />
        {canRemove && <IconBtn icon="trash" label={dt("Убрать из задачи", "Remove from the task")} onClick={onRemove} />}
      </div>
    </li>
  );
}

function UploadRow({ u, en, onCancel }: { u: Uploading; en: boolean; onCancel: () => void }) {
  const dt = useDt();
  const pct = Math.round(u.share * 100);
  return (
    <li className="flex items-center gap-2.5 border-b border-line px-2.5 py-2 last:border-b-0">
      <KindBadge name={u.name} />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink" style={{ fontSize: 13.5 }}>{u.name}</span>
        {u.error ? (
          <span className="block truncate" style={{ fontSize: 11.5, color: "var(--pri-high)" }}>{u.error}</span>
        ) : (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </span>
            <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{pct}% · {formatSize(u.size, en)}</span>
          </span>
        )}
      </div>
      <IconBtn icon="x" label={u.error ? dt("Скрыть", "Dismiss") : dt("Отменить загрузку", "Cancel upload")} onClick={onCancel} />
    </li>
  );
}

function IconBtn({ icon, label, onClick }: { icon: RoyIconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="rounded-[7px] p-1.5 text-ink-mute transition-colors hover:bg-surface hover:text-ink">
      <RoyIcon name={icon} size={15} strokeWidth={1.8} />
    </button>
  );
}
