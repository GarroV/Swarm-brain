"use client";
import type { ReactNode, Ref } from "react";
import { useDt } from "@/components/roy/nav";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { cn } from "@/lib/utils";
import { fileExt, fileKind, formatSize, type FileKind, type TaskFile } from "@/lib/taskFiles";
import { CardIconBar, CardSectionHeader, CardSectionMenu, MenuTitle } from "@/components/tasks/CardSectionMenu";
import { useTaskFiles, type TaskFilesState, type Uploading } from "@/components/tasks/useTaskFiles";

// Файлы к задаче (#638, решение владельца 2026-09-30: «не забудь проработать визуал. это важно»).
// Блок живёт в карточке задачи (TaskModal и экран TaskDetail) рядом с подзадачами и комментариями.
// Лимит показывается честно, до выбора файла: «до 50 МБ · до 10 файлов» — цифры приходят с сервера,
// и отказ по размеру или типу звучит сразу, а не после минуты загрузки. Байты лежат на MUSPELHEIM:
// если он недоступен, блок говорит об этом, а не делает вид, что файлов нет.
//
// С 01.10.2026 пустой раздел не рисуется: от него остаётся пиктограмма со скрепкой, а выбор и бросок
// файла живут в её меню (FilePickPanel). Бросить файл можно и на всю карточку — FileDropOverlay.
// Состояние и загрузка — в хуке useTaskFiles.

const KIND_ICON: Record<FileKind, RoyIconName> = {
  pdf: "pdf", image: "image", sheet: "board", slides: "graph", doc: "doc", archive: "clip", other: "doc",
};

function useLoc() {
  const dt = useDt();
  const en = dt("ru", "en") === "en";
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" });
  return { dt, en, date };
}

/** Скрытый input выбора файлов. Живёт вне меню: меню закрывается раньше, чем браузер вернёт выбор. */
export function FileInput({ f }: { f: TaskFilesState }) {
  return (
    <input
      ref={f.inputRef}
      type="file"
      multiple
      hidden
      accept={f.limits?.accept.map((x) => `.${x}`).join(",")}
      onChange={(e) => {
        if (e.target.files) f.pick(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

/** Содержимое меню скрепки: «Выбрать файл» и зона, куда можно бросить файл. */
export function FilePickPanel({ f, onPicked }: { f: TaskFilesState; onPicked?: () => void }) {
  const dt = useDt();
  if (!f.available || !f.limits) {
    return (
      <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt("Хранилище файлов сейчас недоступно", "File storage is unreachable right now")}
      </p>
    );
  }
  return (
    <div
      className="flex flex-col gap-2"
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("Files")) onPicked?.();
      }}
    >
      <MenuTitle>{dt("Файл", "File")}</MenuTitle>
      <button
        type="button"
        disabled={f.full}
        onClick={() => {
          onPicked?.();
          f.choose();
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-full border border-dashed border-line-2 px-3 py-4 text-ink-mute transition-colors",
          "hover:border-primary/50 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:hover:border-line-2 disabled:hover:text-ink-mute",
        )}
        style={{ fontSize: 12.5 }}
      >
        <RoyIcon name="upload" size={16} strokeWidth={1.8} className="shrink-0" />
        <span>
          <span className="font-medium text-primary">{dt("Выбрать файл", "Choose a file")}</span>
          <span className="hidden lg:inline">{dt(" или перетащите сюда", " or drop it here")}</span>
        </span>
        <span className="text-ink-mute" style={{ fontSize: 11.5 }}>
          {f.full ? f.reasonText("too_many") : f.limitText}
        </span>
      </button>
    </div>
  );
}

/** Подсветка броска файла поверх карточки — пока над ней тащат файл. */
export function FileDropOverlay({ show }: { show: boolean }) {
  const dt = useDt();
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border-2 border-dashed border-primary bg-background/85 backdrop-blur-[2px]">
      <span className="inline-flex items-center gap-2 font-semibold text-primary" style={{ fontSize: 13.5 }}>
        <RoyIcon name="upload" size={16} strokeWidth={2} />
        {dt("Отпустите — прикрепим к задаче", "Drop to attach to the task")}
      </span>
    </div>
  );
}

/** Меню скрепки целиком — для строки пустых разделов (variant "icon") и для «+» у заголовка. */
export function FilesMenu({ f, variant = "icon", triggerRef, onDone }: {
  f: TaskFilesState;
  variant?: "icon" | "plus";
  triggerRef?: Ref<HTMLButtonElement>;
  /** Файл выбран или брошен на меню — меню закрыто. */
  onDone?: () => void;
}) {
  const dt = useDt();
  return (
    <CardSectionMenu
      icon="clip"
      variant={variant}
      label={dt("Прикрепить файл", "Attach a file")}
      disabled={variant === "plus" && f.full}
      width={280}
      triggerRef={triggerRef}
    >
      {(close) => (
        <FilePickPanel
          f={f}
          onPicked={() => {
            close();
            onDone?.();
          }}
        />
      )}
    </CardSectionMenu>
  );
}

/** Непустой раздел «Файлы»: заголовок с «+» (action), список, загрузки и отказы. Пустой не рисуется. */
export function TaskFilesSection({ f, action }: { f: TaskFilesState; action?: ReactNode }) {
  const { dt, en, date } = useLoc();
  if (!f.loaded || f.empty) return null;
  const { files, uploads, rejected, count } = f;

  return (
    <div>
      <CardSectionHeader
        title={dt("Файлы", "Files")}
        count={count > 0 ? count : undefined}
        action={f.available && f.limits ? action : undefined}
      />

      {!f.available && (
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
          {(files ?? []).map((file) => (
            <FileRow key={file.id} file={file} en={en} date={date} canRemove={f.canRemove(file)} onOpen={() => f.open(file)} onRemove={() => f.remove(file)} />
          ))}
          {uploads.map((u) => <UploadRow key={u.key} u={u} en={en} onCancel={() => f.cancelUpload(u)} />)}
        </ul>
      )}

      {rejected.length > 0 && (
        <div role="status" className="mt-2 rounded-[8px] border border-line bg-surface-2 px-3 py-2" style={{ fontSize: 12.5 }}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              {rejected.map((r) => (
                <p key={r.key} className="text-ink-soft">
                  <span className="font-medium text-ink">{r.name}</span> — {f.reasonText(r.reason)}
                </p>
              ))}
            </div>
            <button type="button" onClick={f.dismissRejected} aria-label={dt("Скрыть", "Dismiss")}
              className="shrink-0 rounded p-0.5 text-ink-mute hover:bg-surface hover:text-ink">
              <RoyIcon name="x" size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Самостоятельный блок «Файлы» — для экрана TaskDetail, где нет общей строки пиктограмм. */
export function TaskFiles({ taskId, taskCreatorId }: { taskId: string; taskCreatorId: number | null }) {
  const dt = useDt();
  const f = useTaskFiles(taskId, taskCreatorId);
  return (
    <div className="relative" {...f.dropProps}>
      <FileInput f={f} />
      {f.empty
        ? (
          <CardIconBar label={dt("Добавить к задаче", "Add to the task")}>
            <FilesMenu f={f} />
          </CardIconBar>
        )
        : <TaskFilesSection f={f} action={<FilesMenu f={f} variant="plus" />} />}
      <FileDropOverlay show={f.dragging} />
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
      className="rounded-full p-1.5 text-ink-mute transition-colors hover:bg-surface hover:text-ink">
      <RoyIcon name={icon} size={15} strokeWidth={1.8} />
    </button>
  );
}
