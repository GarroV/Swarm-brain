// Подготовка своей картинки фона: принять «что угодно» (решение владельца 24.09.2026) — JPEG, PNG,
// WebP, AVIF, GIF, BMP, SVG, фото с айфона (HEIC/HEIF), огромные снимки — и привести к размеру
// экрана, чтобы фон не весил десятки мегабайт и не тормозил отрисовку.
//
// Порядок декодирования: createImageBitmap (быстро, учитывает поворот из EXIF) → <img> (SVG, а в
// Safari ещё HEIC и TIFF) → heic-to (HEIC в Chrome/Firefox; 3 МБ кода, грузится только по нужде).

export type BackdropImageErrorCode = "not_image" | "too_big" | "decode_failed" | "encode_failed";

export class BackdropImageError extends Error {
  constructor(readonly code: BackdropImageErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "BackdropImageError";
  }
}

export const MAX_INPUT_BYTES = 60 * 1024 * 1024;
/** Анимированный GIF храним как есть (иначе замрёт на первом кадре), но не бесконечно тяжёлый. */
const KEEP_GIF_BYTES = 12 * 1024 * 1024;
/** Уже лёгкий снимок нужного размера не пережимаем — лишняя потеря качества. */
const KEEP_SMALL_BYTES = 2 * 1024 * 1024;
const MIN_SIDE = 1920;
const MAX_SIDE = 3840;

const IMAGE_EXT = /\.(jpe?g|jfif|png|apng|gif|webp|avif|bmp|svg|heic|heif|tiff?|ico|jxl)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const SVG_EXT = /\.svg$/i;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

function isHeicFile(file: File): boolean {
  return /heic|heif/i.test(file.type) || HEIC_EXT.test(file.name);
}

async function viaBitmap(blob: Blob): Promise<Decoded> {
  const bmp = await createImageBitmap(blob);
  return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
}

function viaImg(blob: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // У SVG без размеров natural* бывает 0 — рисуем в размер экрана.
      const width = img.naturalWidth || MIN_SIDE;
      const height = img.naturalHeight || Math.round(MIN_SIDE * 9 / 16);
      resolve({ source: img, width, height, close: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img decode failed")); };
    img.src = url;
  });
}

async function viaHeic(file: File): Promise<Decoded> {
  const { heicTo } = await import("heic-to/csp");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
  return viaBitmap(jpeg);
}

async function decode(file: File): Promise<Decoded> {
  const errors: unknown[] = [];
  for (const attempt of [() => viaBitmap(file), () => viaImg(file)]) {
    try { return await attempt(); } catch (e) { errors.push(e); }
  }
  if (isHeicFile(file)) {
    try { return await viaHeic(file); } catch (e) { errors.push(e); }
  }
  throw new BackdropImageError("decode_failed", errors);
}

/** Длинная сторона под этот экран: не меньше Full HD, не больше 4K. */
export function targetLongSide(screenW: number, screenH: number, dpr: number): number {
  const need = Math.ceil(Math.max(screenW, screenH) * Math.min(Math.max(dpr, 1), 2));
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, need));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encode(d: Decoded, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new BackdropImageError("encode_failed");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(d.source, 0, 0, width, height);
  // WebP держит прозрачность и легче JPEG. Safari WebP не кодирует и молча отдаёт PNG —
  // тяжёлый PNG тогда пережимаем в JPEG.
  const webp = await toBlob(canvas, "image/webp", 0.86);
  if (webp && webp.type === "image/webp") return webp;
  if (webp && webp.size <= KEEP_SMALL_BYTES * 2) return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.88);
  if (!jpeg) throw new BackdropImageError("encode_failed");
  return jpeg;
}

export async function prepareBackdropImage(
  file: File,
  screen: { width: number; height: number; dpr: number },
): Promise<PreparedImage> {
  if (!isImageFile(file)) throw new BackdropImageError("not_image");
  if (file.size > MAX_INPUT_BYTES) throw new BackdropImageError("too_big");

  const d = await decode(file);
  try {
    const long = targetLongSide(screen.width, screen.height, screen.dpr);
    // Вектор рисуем сразу в размер экрана: его «родные» 300×150 растянутые на весь фон — мыло.
    const isVector = file.type === "image/svg+xml" || SVG_EXT.test(file.name);
    const fit = long / Math.max(d.width, d.height);
    const scale = isVector ? fit : Math.min(1, fit);
    const width = Math.max(1, Math.round(d.width * scale));
    const height = Math.max(1, Math.round(d.height * scale));

    if (file.type === "image/gif" && file.size <= KEEP_GIF_BYTES) {
      return { blob: file, width: d.width, height: d.height };
    }
    const light = /^image\/(jpeg|webp|avif)$/.test(file.type) && file.size <= KEEP_SMALL_BYTES;
    if (scale === 1 && light) return { blob: file, width, height };

    return { blob: await encode(d, width, height), width, height };
  } finally {
    d.close();
  }
}
