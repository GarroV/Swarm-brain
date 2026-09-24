"use client";
import { useEffect, useRef, useState } from "react";
import { BackdropImageError, type BackdropImageErrorCode, prepareBackdropImage } from "@/lib/backdropImage";
import {
  BLUR_MAX, type CustomBackdrop, DEFAULT_BLUR, DEFAULT_DIM, deleteCustomBackdrop, DIM_MAX, saveCustomBackdrop,
} from "@/lib/backdropStore";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";

// Своя картинка фона: загрузка (кнопкой или перетаскиванием), затемнение, размытие, удаление.
// Всё хранится в IndexedDB этого браузера (lib/backdropStore.ts).

const SAVE_DELAY_MS = 250;

type Dt = (ru: string, en: string) => string;

function errorText(code: BackdropImageErrorCode | "storage", dt: Dt): string {
  switch (code) {
    case "not_image":
      return dt("Это не картинка. Подойдёт любое фото или изображение: JPG, PNG, HEIC, WebP, GIF, SVG…",
        "That's not an image. Any photo or picture works: JPG, PNG, HEIC, WebP, GIF, SVG…");
    case "too_big":
      return dt("Файл больше 60 МБ — выберите поменьше.", "The file is over 60 MB — pick a smaller one.");
    case "decode_failed":
      return dt("Не получилось открыть файл как картинку. Попробуйте сохранить его как JPG или PNG.",
        "Couldn't open the file as an image. Try saving it as JPG or PNG.");
    default:
      return dt("Не удалось сохранить картинку в браузере — возможно, приватный режим или не хватает места.",
        "Couldn't store the image in this browser — maybe private mode or not enough space.");
  }
}

export function CustomBackdropPanel({ rec, onSaved, onDeleted }: {
  rec: CustomBackdrop | null;
  onSaved: (rec: CustomBackdrop) => void;
  onDeleted: () => void;
}) {
  const dt = useDt();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dim, setDim] = useState(rec?.dim ?? DEFAULT_DIM);
  const [blur, setBlur] = useState(rec?.blur ?? DEFAULT_BLUR);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDim(rec?.dim ?? DEFAULT_DIM); setBlur(rec?.blur ?? DEFAULT_BLUR); }, [rec]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const store = async (next: CustomBackdrop) => {
    try {
      await saveCustomBackdrop(next);
      onSaved(next);
    } catch (e) {
      console.error("[CustomBackdropPanel] save failed", e);
      setError(errorText("storage", dt));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const img = await prepareBackdropImage(file, {
        width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio || 1,
      });
      await store({ ...img, name: file.name, dim, blur, updatedAt: Date.now() });
    } catch (e) {
      // Не тот файл — ожидаемый исход, о нём уже сказано человеку; громко пишем только настоящие сбои.
      const expected = e instanceof BackdropImageError && e.code !== "encode_failed";
      (expected ? console.warn : console.error)("[CustomBackdropPanel] prepare failed", e);
      setError(errorText(e instanceof BackdropImageError ? e.code : "decode_failed", dt));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const tune = (patch: { dim?: number; blur?: number }) => {
    if (patch.dim !== undefined) setDim(patch.dim);
    if (patch.blur !== undefined) setBlur(patch.blur);
    if (!rec) return;
    if (timer.current) clearTimeout(timer.current);
    const next = { ...rec, dim: patch.dim ?? dim, blur: patch.blur ?? blur, updatedAt: Date.now() };
    timer.current = setTimeout(() => { void store(next); }, SAVE_DELAY_MS);
  };

  const remove = async () => {
    try {
      await deleteCustomBackdrop();
      onDeleted();
    } catch (e) {
      console.error("[CustomBackdropPanel] delete failed", e);
      setError(errorText("storage", dt));
    }
  };

  return (
    <div
      className={`space-y-3 rounded-[8px] border border-dashed p-3 transition-colors ${dragOver ? "border-primary bg-accent-soft" : "border-line-2"}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files[0]); }}
    >
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif,.avif,.svg"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-primary px-3 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          style={{ fontSize: 12.5 }}
        >
          <RoyIcon name="plus" size={14} strokeWidth={2.2} />
          {busy ? dt("Обрабатываю…", "Processing…") : rec ? dt("Загрузить другую", "Upload another") : dt("Загрузить картинку", "Upload image")}
        </button>
        {rec && (
          <button
            type="button"
            onClick={() => void remove()}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line-2 bg-surface px-3 font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-[var(--pri-high)]"
            style={{ fontSize: 12.5 }}
          >
            <RoyIcon name="trash" size={14} />
            {dt("Удалить", "Remove")}
          </button>
        )}
        <span className="text-ink-mute" style={{ fontSize: 11.5 }}>
          {rec
            ? `${rec.name} · ${rec.width}×${rec.height}`
            : dt("или перетащите файл сюда", "or drop a file here")}
        </span>
      </div>
      {rec && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider label={dt("Затемнение", "Dim")} value={dim} max={DIM_MAX} unit="%" onChange={(v) => tune({ dim: v })} />
          <Slider label={dt("Размытие", "Blur")} value={blur} max={BLUR_MAX} unit="px" onChange={(v) => tune({ blur: v })} />
        </div>
      )}
      <p className="text-ink-mute" style={{ fontSize: 11.5 }}>
        {dt("Картинка хранится только в этом браузере и никуда не отправляется. На другом устройстве её нужно загрузить заново.",
          "The image stays in this browser and is never uploaded. On another device, upload it again.")}
      </p>
      {error && <p className="text-[var(--pri-high)]" role="alert" style={{ fontSize: 12 }}>{error}</p>}
    </div>
  );
}

function Slider({ label, value, max, unit, onChange }: {
  label: string; value: number; max: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-ink-soft" style={{ fontSize: 12 }}>
        <span className="font-medium">{label}</span>
        <span className="font-mono text-ink-mute">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </label>
  );
}
