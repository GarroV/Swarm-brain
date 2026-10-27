// Разбор частей аудио из multipart-выгрузки (sys_parts/mic_parts + легаси audio/audio_mic).
// Общий для основного приёма (index.ts) и серверного бэкапа (backup.ts).
import type { InMemoryPart } from "../_shared/meeting-processor.ts";

// Лимит файла на эндпоинте транскрибации OpenAI — часть не должна его превышать (рекордер режет).
export const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

function fail(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}

// Ошибка разбора частей с HTTP-статусом (413 для превышения лимита, 400 для прочего).
export class PartError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Собирает части одной дорожки. Новый путь — JSON-манифест `manifestField` ([{name,offset}])
// + файлы по `name`. Легаси-путь — одиночный файл `legacyField` (offset 0). Файлы буферизуются
// в память (req.formData() уже прочитал тело). Бросает PartError при невалидном вводе/превышении.
export async function buildTrackParts(
  formData: FormData,
  manifestField: string,
  legacyField: string,
  fallbackName: string,
  legacyMinSize: number,
): Promise<InMemoryPart[]> {
  const toPart = async (
    file: File,
    name: string,
    offset: number,
  ): Promise<InMemoryPart> => {
    const buf = await file.arrayBuffer();
    return {
      blob: new Blob([buf], { type: file.type || "audio/m4a" }),
      name: file.name && file.name.length > 0 ? file.name : name,
      offset,
    };
  };

  const raw = formData.get(manifestField);
  if (typeof raw === "string" && raw.length > 0) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(raw);
    } catch {
      throw new PartError(`${manifestField}: invalid JSON manifest`);
    }
    if (!Array.isArray(manifest)) {
      throw new PartError(`${manifestField}: manifest must be an array`);
    }
    const parts: InMemoryPart[] = [];
    const seen = new Set<string>();
    for (
      const item of manifest as Array<{ name?: unknown; offset?: unknown }>
    ) {
      const name = typeof item?.name === "string" ? item.name : "";
      const offset = Number(item?.offset);
      if (!name) throw new PartError(`${manifestField}: part name required`);
      if (seen.has(name)) {
        throw new PartError(`${manifestField}: duplicate part name "${name}"`);
      }
      seen.add(name);
      if (!Number.isFinite(offset) || offset < 0) {
        throw new PartError(`${manifestField}: bad offset for "${name}"`);
      }
      const file = formData.get(name);
      if (!(file instanceof File)) {
        throw new PartError(`${manifestField}: file "${name}" missing`);
      }
      if (file.size === 0) {
        throw new PartError(`${manifestField}: file "${name}" empty`);
      }
      if (file.size > OPENAI_AUDIO_MAX_BYTES) {
        throw new PartError(`part "${name}" too large (>25MB)`, 413);
      }
      parts.push(await toPart(file, `${name}.m4a`, offset));
    }
    return parts;
  }

  // Легаси: один файл, offset 0. Пустой/мелкий (mic без доступа) → дорожки нет.
  const legacy = formData.get(legacyField);
  if (!(legacy instanceof File) || legacy.size <= legacyMinSize) return [];
  if (legacy.size > OPENAI_AUDIO_MAX_BYTES) {
    throw new PartError(`${legacyField} too large (>25MB)`, 413);
  }
  return [await toPart(legacy, fallbackName, 0)];
}

export interface TrackParts {
  systemParts: InMemoryPart[];
  micParts: InMemoryPart[];
}

// Части обеих дорожек (файлы уже в памяти после req.formData()) или готовый ответ об ошибке.
export async function readParts(formData: FormData): Promise<TrackParts | Response> {
  let systemParts: InMemoryPart[];
  let micParts: InMemoryPart[];
  try {
    systemParts = await buildTrackParts(formData, "sys_parts", "audio", "audio.m4a", 1);
    micParts = await buildTrackParts(formData, "mic_parts", "audio_mic", "audio_mic.m4a", 1024);
  } catch (e) {
    if (e instanceof PartError) return fail(e.message, e.status);
    throw e;
  }
  // Принимаем запись с ОДНОЙ дорожкой: только система ИЛИ только микрофон. mic-only — частый кейс:
  // юзер говорил, но через систему ничего не воспроизводилось → sys-дорожка пустая, рекордер её не
  // шлёт (гард >1024Б в Segmenter). Отклоняем лишь совсем пустую запись (нет ни одной дорожки).
  if (systemParts.length === 0 && micParts.length === 0) {
    return fail("audio required (sys_parts/mic_parts manifest or legacy audio field)");
  }
  return { systemParts, micParts };
}
