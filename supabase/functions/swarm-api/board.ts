// Доска «Сегодня» рекордера (Bumblebee) и задача голосом: docs/decisions/2026-10-22-bumblebee-hub.md.
//
// Рекордер ходит сюда веб-сессией, которую получает обменом своего токена (meeting-webtoken), —
// авторизация и воркспейс те же, что у остальных маршрутов, их проверил index.ts.
//
//   GET  /board/today?date=YYYY-MM-DD&tz_offset=<мин>
//        200 { config, tasks: [{id,title,due_date,status}], tasks_total, meetings, meetings_reason? }
//        · tasks — мои живые задачи со сроком ≤ date, просроченные сверху; до BOARD_TASKS_LIMIT, обрезка до
//          task_rows — на клиенте · meetings_reason — как у GET /calendar/today (календарь не подключён и т.п.)
//        · 400 bad_date
//   POST /tasks/voice  multipart: audio (m4a/webm/wav, ≤ 2 МБ), date, tz_offset, lang?
//        201 { task: {id,title,description,country,due_date}, heard }
//        · 400 bad_request|bad_date|bad_audio · 411 length_required · 403 demo_not_allowed · 413 audio_too_large
//        · 415 unsupported_media · 422 nothing_heard · 502 transcription_unavailable
//        Задача создаётся сразу, на звонящего, confirmed, source = recorder_voice. Отмена — обычные
//        DELETE /tasks/:id (архивация) и POST /tasks/:id/restore. Аудио нигде не хранится.
//
//   GET  /board/call?key=<identity_key>&title=<название>&date=&tz_offset=
//        200 { series_key, country, suggested, markets, tasks: [{id,title,due_date,remind_date,status}] }
//        · country — метка серии созвона (calendar_series_country), общая для всех; tasks — только при ней:
//          мои (исполнитель или соисполнитель) живые задачи этой страны, порядок sortCallTasks, до BOARD_TASKS_LIMIT
//        · suggested — страна из названия, только когда метки нет · 400 bad_key · 403 demo_not_allowed
//   PUT  /board/call  { key, country: "RS" | null }  — поставить или снять метку серии; ответ как у GET
//        · 400 bad_key|bad_country (страна вне allowed_markets) · 403 demo_not_allowed
//
// Ошибки голоса и экрана страны: { error: <EN>, error_ru: <RU>, code } — рекордер показывает по коду.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { loadTodayMeetings } from "./today-meetings.ts";
import { createTask, listTasksWithTotal } from "../_shared/tasks/db.ts";
import { todayInTz } from "../_shared/tasks/recurrence.ts";
import { COUNTRY_NAMES } from "../_shared/countries.ts";
import { parseBoardConfig, RECORDER_BOARD_KEY } from "../_shared/board-config.ts";
import { transcribeShortClip } from "../_shared/short-transcribe.ts";
import { normalizeVoiceTask } from "../_shared/voice-task.ts";
import { parseVoiceTask } from "../_shared/voice-task-llm.ts";
import { resolvePersonNames } from "../_shared/users/display-name.ts";
import { nextDay, seriesKeyOf, sortCallTasks, suggestCountryFromTitle } from "../_shared/calendar-series.ts";

/** Сколько задач отдаём клиенту; обрезку до task_rows делает он, остаток считает tasks_total. */
export const BOARD_TASKS_LIMIT = 200;
/** Потолок клипа диктовки: короткая фраза, не запись встречи. */
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
/** Запас на multipart-обвязку поверх файла при проверке Content-Length. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const SOURCE = "recorder_voice";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_RE = /^[a-z]{2,3}$/;
const TASK_COLUMNS = "id, title, due_date, status, created_at";
const CALL_TASK_COLUMNS = "id, title, due_date, remind_date, status, created_at, country";
const MAX_KEY_LENGTH = 512;

const ERRORS = {
  bad_request: {
    status: 400,
    en: "Send multipart/form-data with an audio file",
    ru: "Нужен multipart/form-data с аудиофайлом",
  },
  length_required: { status: 411, en: "Content-Length is required", ru: "Нужен заголовок Content-Length" },
  bad_date: { status: 400, en: "date must be YYYY-MM-DD", ru: "date — в формате YYYY-MM-DD" },
  bad_audio: { status: 400, en: "Audio file is missing or empty", ru: "Аудиофайла нет или он пустой" },
  demo_not_allowed: {
    status: 403,
    en: "Not available in the demo",
    ru: "В демо недоступно",
  },
  bad_key: { status: 400, en: "key is required", ru: "Нужен key — ключ встречи" },
  bad_country: {
    status: 400,
    en: "country must be one of the workspace markets or null",
    ru: "country — один из рынков пространства или null",
  },
  audio_too_large: {
    status: 413,
    en: `Audio is larger than ${MAX_VOICE_BYTES / 1024 / 1024} MB`,
    ru: `Аудио больше ${MAX_VOICE_BYTES / 1024 / 1024} МБ`,
  },
  unsupported_media: { status: 415, en: "Audio must be m4a, webm or wav", ru: "Аудио должно быть m4a, webm или wav" },
  nothing_heard: { status: 422, en: "Heard nothing — try again", ru: "Ничего не услышал — попробуйте ещё раз" },
  transcription_unavailable: {
    status: 502,
    en: "Transcription is unavailable right now. Try again in a minute.",
    ru: "Расшифровка сейчас недоступна. Попробуйте через минуту.",
  },
} as const;

type ErrorCode = keyof typeof ERRORS;

function err(code: ErrorCode, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

export interface BoardContext {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string;
  isDemo: boolean;
  origin: string;
}

/** Клиентская дата или null, если она не календарная YYYY-MM-DD. */
export function validDate(raw: string | null): string | null {
  if (!raw || !DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

/** «Сегодня» клиента: его дата, а без неё — по его поясу (tz_offset — минуты впереди UTC), иначе по TASK_TZ. */
export function clientToday(date: string | null, tzOffset: string | null, now: Date = new Date()): string {
  if (date) return date;
  const off = Number(tzOffset);
  if (tzOffset !== null && tzOffset !== "" && Number.isFinite(off)) {
    return new Date(now.getTime() + off * 60_000).toISOString().slice(0, 10);
  }
  return todayInTz(now);
}

/** Расширение файла по MIME или имени; null — формат не из списка. */
export function audioExt(mime: string, name: string): "m4a" | "webm" | "wav" | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "video/mp4"].includes(m)) return "m4a";
  if (["audio/webm", "video/webm"].includes(m)) return "webm";
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(m)) return "wav";
  if (m && m !== "application/octet-stream") return null;
  const ext = name.toLowerCase().split(".").pop();
  return ext === "m4a" || ext === "mp4" ? "m4a" : ext === "webm" ? "webm" : ext === "wav" ? "wav" : null;
}

async function loadConfig(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", RECORDER_BOARD_KEY)
    .maybeSingle();
  if (error) console.warn("[board] app_settings.recorder_board не прочитался, берём дефолты:", error.message);
  return parseBoardConfig((data as { value?: unknown } | null)?.value);
}

async function handleToday(ctx: BoardContext, url: URL): Promise<Response> {
  const { supabase, telegramId, groupId, origin } = ctx;
  const dateParam = url.searchParams.get("date");
  const date = validDate(dateParam);
  if (dateParam && !date) return err("bad_date", origin);
  const today = clientToday(date, url.searchParams.get("tz_offset"));
  const tz = Number(url.searchParams.get("tz_offset") ?? "0");

  try {
    const [config, listed, meetings] = await Promise.all([
      loadConfig(supabase),
      // Те же помощники и видимость, что у GET /tasks: воркспейс, закрытые проекты, живые (не архив),
      // без done/cancelled/draft (правило hidesClosedByDefault).
      listTasksWithTotal(
        { columns: TASK_COLUMNS, telegramId, viewerId: telegramId, dueDateTo: today, limit: BOARD_TASKS_LIMIT },
        groupId,
      ),
      loadTodayMeetings(supabase, telegramId, Number.isFinite(tz) ? tz : 0, "board/today"),
    ]);
    const tasks = [...listed.tasks]
      .sort((a, b) =>
        (a.due_date ?? "").localeCompare(b.due_date ?? "") || (a.created_at ?? "").localeCompare(b.created_at ?? "")
      )
      .map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, status: t.status }));
    return json(
      {
        config,
        tasks,
        tasks_total: listed.total ?? tasks.length,
        meetings: meetings.ok ? meetings.meetings : [],
        ...(meetings.ok ? {} : { meetings_reason: meetings.reason }),
      },
      200,
      origin,
    );
  } catch (e) {
    return serverError(origin, "board today", e);
  }
}

async function allowedMarketsOf(supabase: SupabaseClient, groupId: string): Promise<string[]> {
  const { data } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  // Как GET /config: строки нет или рынки не заданы — все известные.
  return (data as { allowed_markets: string[] | null } | null)?.allowed_markets ?? Object.keys(COUNTRY_NAMES);
}

async function handleVoice(ctx: BoardContext, req: Request): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, origin } = ctx;
  if (isDemo) return err("demo_not_allowed", origin);
  // Размер проверяем ДО чтения тела: formData() втянул бы в память всё, что прислали. Длина обязательна:
  // рекордер всегда её шлёт, chunked без длины не принимаем.
  const lengthHeader = req.headers.get("content-length");
  const declared = lengthHeader !== null && /^\d+$/.test(lengthHeader.trim()) ? Number(lengthHeader) : NaN;
  if (!Number.isFinite(declared)) return err("length_required", origin);
  if (declared > MAX_VOICE_BYTES + MULTIPART_OVERHEAD_BYTES) return err("audio_too_large", origin);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return err("bad_request", origin);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err("bad_request", origin);
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return err("bad_audio", origin);
  if (audio.size > MAX_VOICE_BYTES) return err("audio_too_large", origin);
  const ext = audioExt(audio.type, audio.name);
  if (!ext) return err("unsupported_media", origin);
  const dateRaw = form.get("date");
  const date = typeof dateRaw === "string" && dateRaw ? validDate(dateRaw) : null;
  if (typeof dateRaw === "string" && dateRaw && !date) return err("bad_date", origin);
  const tz = form.get("tz_offset");
  const today = clientToday(date, typeof tz === "string" ? tz : null);
  const langRaw = form.get("lang");
  const lang = typeof langRaw === "string" && LANG_RE.test(langRaw.toLowerCase()) ? langRaw.toLowerCase() : undefined;

  const auth = { supabase, groupId };
  let heard: string;
  try {
    // Аудио живёт только в памяти этого запроса: ни Storage, ни база его не получают.
    ({ text: heard } = await transcribeShortClip(auth, audio, `voice.${ext}`, { lang }));
  } catch (e) {
    console.error("[tasks/voice] расшифровка не удалась:", e instanceof Error ? e.message : String(e));
    return err("transcription_unavailable", origin);
  }
  if (!heard) return err("nothing_heard", origin);

  try {
    // Сбой разбора не теряет диктовку: без полей от модели заголовком станет расшифровка.
    const parsed = await parseVoiceTask(auth, heard, today).catch((e) => {
      console.error("[tasks/voice] разбор не удался:", e instanceof Error ? e.message : String(e));
      return null;
    });
    const fields = normalizeVoiceTask(parsed, {
      today,
      allowedMarkets: await allowedMarketsOf(supabase, groupId),
      transcript: heard,
    });
    if (!fields) return err("nothing_heard", origin);
    const name = (await resolvePersonNames(supabase, [telegramId])).get(telegramId) ?? String(telegramId);
    const task = await createTask({
      title: fields.title,
      description: fields.description,
      country: fields.country,
      due_date: fields.due_date,
      status: "open",
      source: SOURCE,
      confirmed: true,
      assignees: [name],
      assignee_telegram_ids: [telegramId],
      created_by_telegram_id: telegramId,
    }, groupId);
    return json(
      {
        task: {
          id: task.id,
          title: task.title,
          description: task.description ?? null,
          country: task.country ?? null,
          due_date: task.due_date,
        },
        heard,
      },
      201,
      origin,
    );
  } catch (e) {
    return serverError(origin, "tasks voice", e);
  }
}

/** Метка серии и, если она есть, мои задачи этой страны; без метки — подсказка из названия. */
async function buildCallView(
  ctx: BoardContext,
  seriesKey: string,
  title: string,
  today: string,
): Promise<Record<string, unknown>> {
  const { supabase, telegramId, groupId } = ctx;
  const [markets, labelled] = await Promise.all([
    allowedMarketsOf(supabase, groupId),
    supabase.from("calendar_series_country").select("country").eq("group_id", groupId).eq("series_key", seriesKey)
      .maybeSingle(),
  ]);
  if (labelled.error) throw new Error(`calendar_series_country: ${labelled.error.message}`);
  const country = (labelled.data as { country: string } | null)?.country ?? null;
  if (!country) {
    return {
      series_key: seriesKey,
      country: null,
      suggested: suggestCountryFromTitle(title, markets),
      markets,
      tasks: [],
    };
  }
  // Видимость и «живые» — те же помощники, что у GET /tasks; исполнитель/соисполнитель — telegramId.
  const listed = await listTasksWithTotal(
    { columns: CALL_TASK_COLUMNS, telegramId, viewerId: telegramId, country, limit: BOARD_TASKS_LIMIT },
    groupId,
  );
  // ilike по подстроке ловит и составную метку «RS,HR» — оставляем задачи, где страна названа точно.
  const mine = listed.tasks.filter((t) => (t.country ?? "").toUpperCase().split(/[\s,;/]+/).includes(country));
  const tasks = sortCallTasks(mine, today, nextDay(today)).map((t) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date,
    remind_date: t.remind_date ?? null,
    status: t.status,
  }));
  return { series_key: seriesKey, country, suggested: null, markets, tasks };
}

async function handleCall(ctx: BoardContext, req: Request): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, origin } = ctx;
  if (isDemo) return err("demo_not_allowed", origin);
  const url = new URL(req.url);
  let key: unknown;
  let title = url.searchParams.get("title") ?? "";
  let setCountry: string | null | undefined;
  if (req.method === "PUT") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return err("bad_key", origin);
    }
    key = body?.key;
    title = typeof body?.title === "string" ? body.title : title;
    setCountry = body?.country === null ? null : typeof body?.country === "string" ? body.country : undefined;
  } else {
    key = url.searchParams.get("key");
  }
  if (typeof key !== "string" || !key.trim() || key.length > MAX_KEY_LENGTH) return err("bad_key", origin);
  const seriesKey = seriesKeyOf(key.trim());
  const dateParam = url.searchParams.get("date");
  const date = validDate(dateParam);
  if (dateParam && !date) return err("bad_date", origin);
  const today = clientToday(date, url.searchParams.get("tz_offset"));

  try {
    if (setCountry !== undefined) {
      if (setCountry === null) {
        const { error } = await supabase.from("calendar_series_country").delete().eq("group_id", groupId)
          .eq("series_key", seriesKey);
        if (error) throw new Error(`calendar_series_country delete: ${error.message}`);
      } else {
        const iso = setCountry.trim().toUpperCase();
        if (!(await allowedMarketsOf(supabase, groupId)).includes(iso)) return err("bad_country", origin);
        const { error } = await supabase.from("calendar_series_country").upsert({
          group_id: groupId,
          series_key: seriesKey,
          country: iso,
          set_by: telegramId,
          set_at: new Date().toISOString(),
        }, { onConflict: "group_id,series_key" });
        if (error) throw new Error(`calendar_series_country upsert: ${error.message}`);
      }
    } else if (req.method === "PUT") {
      return err("bad_country", origin);
    }
    return json(await buildCallView(ctx, seriesKey, title, today), 200, origin);
  } catch (e) {
    return serverError(origin, "board call", e);
  }
}

export async function handleBoardRoutes(
  ctx: BoardContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  if (routePath === "/board/today") {
    if (req.method !== "GET") return apiErr(405, "Method not allowed", ctx.origin);
    return handleToday(ctx, new URL(req.url));
  }
  if (routePath === "/board/call") {
    if (req.method !== "GET" && req.method !== "PUT") return apiErr(405, "Method not allowed", ctx.origin);
    return await handleCall(ctx, req);
  }
  if (routePath === "/tasks/voice") {
    if (req.method !== "POST") return apiErr(405, "Method not allowed", ctx.origin);
    return await handleVoice(ctx, req);
  }
  return null;
}
