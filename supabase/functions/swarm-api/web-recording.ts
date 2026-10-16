// Запись встречи из браузера (офлайн-встреча): docs/decisions/2026-10-16-web-recorder.md.
//
// Человек обычной авторизацией веба (JWT / initData — её уже проверил index.ts) пишет микрофон
// кусками; каждый закрытый кусок уходит сюда сразу, «завершить» собирает куски в обработку встреч.
//
//   POST /meetings/record                      { "started_at"?: ISO, "title"?: string }
//        201 { id, title, started_at }
//   PUT  /meetings/record/:id/segments/:n?offset=<сек от начала записи, 0..86400, дробное>
//        тело — аудио куска целиком, Content-Type audio/mp4 (→ .m4a) или audio/webm (→ .webm);
//        n — 0..999; повтор того же n перезаписывает (идемпотентно)
//        200 { ok: true, n, bytes } · 400 bad_segment|bad_offset · 413 segment_too_large
//        · 415 unsupported_media
//   POST /meetings/record/:id/finish           { "ended_at"?: ISO, "recorded_seconds"?: number }
//        202 { ok: true, id, summary_status: "processing"|"failed", segments: number }
//             ("failed" — ни один кусок не дошёл; "already": true — завершение уже шло рядом)
//   GET  /meetings/record/active
//        200 { recording: { id, started_at, segments: number[] } | null } — незавершённая запись автора
//
//   Общее: 403 demo_not_allowed (демо) · 404 not_found (нет такой, чужой воркспейс, не запись из
//   браузера) · 403 forbidden (запись другого человека) · 409 already_finished (summary_status уже не пуст).
//   Ошибка = { error: <EN>, error_ru: <RU>, code } — веб показывает по коду на своём языке.
//
// Права: SERVICE_ROLE обходит RLS, поэтому проверка — здесь, в коде (CLAUDE.md): строка из нашего
// воркспейса, source='web-recorder', claim_owner — автор. Видимость черновика — recorders=[автор].
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { defaultMeetingTitle } from "../_shared/meeting-title.ts";
import {
  finalizeWebRecording,
  listWebSegments,
  MAX_OFFSET_SEC,
  MAX_SEGMENT_BYTES,
  MAX_SEGMENT_N,
  segmentDir,
  type SegmentExt,
  segmentPath,
  WEB_RECORDER_SOURCE,
} from "../_shared/web-recording.ts";
import { json } from "./http.ts";
import { serverError } from "./client-error.ts";

const BUCKET = "meeting-audio";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE_LEN = 200;
const DEFAULT_TITLE_NAME = "Офлайн-встреча";
const INLINE_BUDGET_MS = 90_000;

declare const EdgeRuntime:
  | { waitUntil: (p: Promise<unknown>) => void }
  | undefined;

const ERRORS = {
  demo_not_allowed: { status: 403, en: "Recording is not available in the demo", ru: "В демо запись недоступна" },
  not_found: { status: 404, en: "Recording not found", ru: "Запись не найдена" },
  forbidden: { status: 403, en: "This recording belongs to someone else", ru: "Это запись другого человека" },
  already_finished: { status: 409, en: "Recording is already finished", ru: "Запись уже завершена" },
  bad_request: { status: 400, en: "Invalid request body", ru: "Некорректное тело запроса" },
  bad_segment: { status: 400, en: "Segment number must be 0..999", ru: "Номер куска должен быть от 0 до 999" },
  bad_offset: {
    status: 400,
    en: `offset must be a number of seconds, 0..${MAX_OFFSET_SEC}`,
    ru: `offset — число секунд от 0 до ${MAX_OFFSET_SEC}`,
  },
  empty_segment: { status: 400, en: "Segment body is empty", ru: "Пустой кусок записи" },
  segment_too_large: {
    status: 413,
    en: `Segment is larger than ${MAX_SEGMENT_BYTES / 1024 / 1024} MB`,
    ru: `Кусок больше ${MAX_SEGMENT_BYTES / 1024 / 1024} МБ`,
  },
  unsupported_media: {
    status: 415,
    en: "Content-Type must be audio/mp4 or audio/webm",
    ru: "Content-Type должен быть audio/mp4 или audio/webm",
  },
} as const;

type ErrorCode = keyof typeof ERRORS;

function err(code: ErrorCode, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

export interface WebRecordingContext {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string;
  isDemo: boolean;
  origin: string;
  /** Один проход обработки после «завершить» (по умолчанию — runMeetingStep, как inline в meeting-ingest). */
  runStep?: (meetingId: string) => Promise<void>;
}

function parseIso(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Тело запроса — необязательный JSON-объект; пустое тело = {}. null — тело есть, но не объект. */
async function readOptionalBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function startRecording(ctx: WebRecordingContext, req: Request): Promise<Response> {
  if (ctx.isDemo) return err("demo_not_allowed", ctx.origin);
  const body = await readOptionalBody(req);
  if (!body) return err("bad_request", ctx.origin);
  const startedAt = body.started_at === undefined ? new Date().toISOString() : parseIso(body.started_at);
  if (!startedAt) return err("bad_request", ctx.origin);
  if (body.title !== undefined && typeof body.title !== "string") return err("bad_request", ctx.origin);
  const title = ((body.title as string | undefined) ?? "").trim().slice(0, MAX_TITLE_LEN) ||
    defaultMeetingTitle(DEFAULT_TITLE_NAME, startedAt);

  const nowIso = new Date().toISOString();
  const { data, error } = await ctx.supabase.from("meetings").insert({
    source: WEB_RECORDER_SOURCE,
    identity_kind: "manual",
    identity_key: `web:${crypto.randomUUID()}`,
    title,
    started_at: startedAt,
    attendees: [],
    group_id: ctx.groupId,
    agent_version: "web-1",
    claim_owner: ctx.telegramId,
    recorders: [{ telegram_id: ctx.telegramId, claimed_at: nowIso }],
  }).select("id").single();
  if (error || !data) return serverError(ctx.origin, "web recording create", error ?? "no row returned");
  const id = (data as { id: string }).id;
  console.log(`swarm-api: запись из браузера ${id} начата ${ctx.telegramId}`);
  return json({ id, title, started_at: startedAt }, 201, ctx.origin);
}

interface OwnRow {
  id: string;
  started_at: string | null;
}

/** Строка записи, к которой у человека есть право: иначе готовый ответ-отказ. */
async function ownRecording(
  ctx: WebRecordingContext,
  id: string,
): Promise<{ row: OwnRow } | { refusal: Response }> {
  const refuse = (code: ErrorCode) => ({ refusal: err(code, ctx.origin) });
  if (!UUID.test(id)) return refuse("not_found");
  const { data, error } = await ctx.supabase.from("meetings")
    .select("id, group_id, source, claim_owner, summary_status, started_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { refusal: serverError(ctx.origin, "web recording lookup", error) };
  const row = data as
    | (OwnRow & {
      group_id: string | null;
      source: string | null;
      claim_owner: number | null;
      summary_status: string | null;
    })
    | null;
  // Чужой воркспейс и «не запись из браузера» неотличимы от несуществующей: id чужих встреч не подтверждаем.
  if (!row || row.group_id !== ctx.groupId || row.source !== WEB_RECORDER_SOURCE) return refuse("not_found");
  if (row.claim_owner !== ctx.telegramId) return refuse("forbidden");
  if (row.summary_status !== null) return refuse("already_finished");
  return { row };
}

function extensionOf(contentType: string | null): SegmentExt | null {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/m4a") return "m4a";
  if (base === "audio/webm" || base === "video/webm") return "webm";
  return null;
}

async function putSegment(
  ctx: WebRecordingContext,
  req: Request,
  id: string,
  nRaw: string,
  url: URL,
): Promise<Response> {
  if (ctx.isDemo) return err("demo_not_allowed", ctx.origin);
  const own = await ownRecording(ctx, id);
  if ("refusal" in own) return own.refusal;

  const n = /^\d{1,3}$/.test(nRaw) ? Number(nRaw) : -1;
  if (n < 0 || n > MAX_SEGMENT_N) return err("bad_segment", ctx.origin);
  const offsetRaw = url.searchParams.get("offset");
  const offset = offsetRaw === null || offsetRaw.trim() === "" ? NaN : Number(offsetRaw);
  if (!Number.isFinite(offset) || offset < 0 || offset > MAX_OFFSET_SEC) return err("bad_offset", ctx.origin);
  const ext = extensionOf(req.headers.get("content-type"));
  if (!ext) return err("unsupported_media", ctx.origin);

  // Отказ по заголовку — до чтения тела: гигабайт в память функции не пускаем.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SEGMENT_BYTES) return err("segment_too_large", ctx.origin);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return err("empty_segment", ctx.origin);
  if (bytes.byteLength > MAX_SEGMENT_BYTES) return err("segment_too_large", ctx.origin);

  const path = segmentPath(id, n, offset, ext);
  const { error: upErr } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: ext === "m4a" ? "audio/mp4" : "audio/webm",
    upsert: true,
  });
  if (upErr) return serverError(ctx.origin, "web recording upload", upErr);

  await dropStaleTwins(ctx.supabase, id, n, path);

  // Отметка активности: по ней сторож брошенных записей понимает, что запись жива.
  const { error: touchErr } = await ctx.supabase.from("meetings")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("summary_status", null);
  if (touchErr) return serverError(ctx.origin, "web recording touch", touchErr);
  return json({ ok: true, n, bytes: bytes.byteLength }, 200, ctx.origin);
}

/** Повтор куска с другим смещением или форматом ложится под другим именем: убираем прежнее, чтобы номер был один. Сбой — не ошибка запроса (finalize и так оставит свежий). */
async function dropStaleTwins(supabase: SupabaseClient, id: string, n: number, keepPath: string): Promise<void> {
  try {
    const prefix = `${String(n).padStart(3, "0")}-`;
    const { data, error } = await supabase.storage.from(BUCKET).list(segmentDir(id), { search: prefix, limit: 100 });
    if (error) throw new Error(error.message);
    const stale = (data ?? [])
      .map((f) => `${segmentDir(id)}/${f.name}`)
      .filter((p) => p !== keepPath && p.startsWith(`${segmentDir(id)}/${prefix}`));
    if (stale.length > 0) await supabase.storage.from(BUCKET).remove(stale);
  } catch (e) {
    console.error(`swarm-api: web recording ${id}: не убрал прежний кусок ${n}:`, e);
  }
}

async function finishRecording(ctx: WebRecordingContext, req: Request, id: string): Promise<Response> {
  if (ctx.isDemo) return err("demo_not_allowed", ctx.origin);
  const own = await ownRecording(ctx, id);
  if ("refusal" in own) return own.refusal;
  const body = await readOptionalBody(req);
  if (!body) return err("bad_request", ctx.origin);
  const endedAt = body.ended_at === undefined ? undefined : parseIso(body.ended_at);
  if (endedAt === null) return err("bad_request", ctx.origin);
  const rs = body.recorded_seconds;
  if (rs !== undefined && (typeof rs !== "number" || !Number.isFinite(rs) || rs < 0 || rs > MAX_OFFSET_SEC)) {
    return err("bad_request", ctx.origin);
  }

  let result;
  try {
    result = await finalizeWebRecording(ctx.supabase, id, { endedAt, recordedSeconds: rs });
  } catch (e) {
    return serverError(ctx.origin, "web recording finalize", e);
  }
  if (result.already) return json({ ok: true, id, already: true }, 200, ctx.origin);
  if (result.failed) return json({ ok: true, id, summary_status: "failed", segments: 0 }, 202, ctx.origin);

  // Короткую встречу добивает сразу; длинную подхватит cron meeting-process (как в meeting-ingest).
  const run = ctx.runStep ?? runStepOn(ctx.supabase);
  const job = run(id).catch((e) => {
    console.error(`swarm-api: web recording inline step failed for ${id} (cron подхватит):`, e);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) EdgeRuntime.waitUntil(job);
  else await job;
  return json({ ok: true, id, summary_status: "processing", segments: result.parts }, 202, ctx.origin);
}

function runStepOn(supabase: SupabaseClient): (meetingId: string) => Promise<void> {
  return (meetingId) =>
    import("../_shared/meeting-processor.ts")
      .then((m) => m.runMeetingStep(supabase, meetingId, INLINE_BUDGET_MS))
      .then(() => {});
}

async function activeRecording(ctx: WebRecordingContext): Promise<Response> {
  const { data, error } = await ctx.supabase.from("meetings")
    .select("id, started_at")
    .eq("group_id", ctx.groupId)
    .eq("source", WEB_RECORDER_SOURCE)
    .eq("claim_owner", ctx.telegramId)
    .is("summary_status", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return serverError(ctx.origin, "web recording active", error);
  if (!data) return json({ recording: null }, 200, ctx.origin);
  const row = data as OwnRow;
  let segments;
  try {
    segments = (await listWebSegments(ctx.supabase, row.id)).map((s) => s.n);
  } catch (e) {
    return serverError(ctx.origin, "web recording segments", e);
  }
  return json({ recording: { id: row.id, started_at: row.started_at, segments } }, 200, ctx.origin);
}

export async function handleWebRecordingRoutes(
  ctx: WebRecordingContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  if (!routePath.startsWith("/meetings/record")) return null;
  if (routePath === "/meetings/record" && req.method === "POST") return await startRecording(ctx, req);
  if (routePath === "/meetings/record/active" && req.method === "GET") return await activeRecording(ctx);
  const seg = routePath.match(/^\/meetings\/record\/([^/]+)\/segments\/([^/]+)$/);
  if (seg && req.method === "PUT") return await putSegment(ctx, req, seg[1], seg[2], new URL(req.url));
  const fin = routePath.match(/^\/meetings\/record\/([^/]+)\/finish$/);
  if (fin && req.method === "POST") return await finishRecording(ctx, req, fin[1]);
  return null;
}
