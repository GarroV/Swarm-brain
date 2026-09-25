import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canAccessDraftMeeting, type DraftMeetingRow, draftMeetingsOwnScoped } from "../_shared/meeting-access.ts";
import { publishDraftMeeting } from "../_shared/meeting-publish.ts";
import { ADMIN_USER_ID, matchAssignee, resolveGroupId } from "./tasks/tools.ts";
import { entryAccessError, type EntryAccessRow } from "../_shared/entries/access.ts";
import { EXTRACT_MAX_TASKS, gptExtractTasks } from "../_shared/task-extract.ts";
import {
  type DraftRow,
  formatDraftMeeting,
  formatProposedTasks,
  formatPublishOutcome,
  formatReviewQueue,
  type ProposedTask,
  type QueueRow,
} from "./meetings-format.ts";

// Вычитка черновиков встреч из MCP (issue #513): очередь, черновик, правка, публикация.
// Живая очередь — таблица meetings (черновики рекордера), а не entries.confirmed=false:
// на 25.09.2026 неподтверждённых записей 0, черновиков на вычитке 68.
//
// Доступ — тем же правилом, что у веба: canAccessDraftMeeting (черновик видит только тот,
// кто записал; админ не исключение). Публикация — тем же кодом, что у веба (publishDraftMeeting).

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const QUEUE_LIMIT = 50;
const TITLE_MAX = 200;
// Ответ публикации агенту: хватает id и признаков склейки, текст записи обратно не нужен.
const PUBLISH_COLUMNS = "id, is_private, metadata";
const NOT_FOUND = "Черновик не найден.";

type Caller = { requesting_user_id?: number };

async function loadOwnDraft(
  meetingId: string,
  callerId: number | undefined,
): Promise<{ ok: true; meeting: Record<string, unknown>; groupId: string } | { ok: false; msg: string }> {
  if (!callerId) return { ok: false, msg: "Ошибка: личность не определена (нужен токен коннектора)." };
  const groupId = await resolveGroupId(callerId);
  const { data } = await supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle();
  const meeting = data as Record<string, unknown> | null;
  // Один текст отказа на «нет такого» и «не твой»: иначе перебором id подтверждается чужой черновик.
  if (!meeting || !groupId || !canAccessDraftMeeting(meeting as DraftMeetingRow, callerId, callerId === ADMIN_USER_ID, groupId)) {
    return { ok: false, msg: NOT_FOUND };
  }
  return { ok: true, meeting, groupId };
}

export async function toolGetReviewQueue(args: Caller): Promise<string> {
  const callerId = args.requesting_user_id;
  if (!callerId) return "Ошибка: личность не определена (нужен токен коннектора).";
  const groupId = await resolveGroupId(callerId);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";
  // Тот же фильтр «только свои», что у GET /agent-meetings (jsonb-containment строкой — см. там).
  const { data, error, count } = await supabase.from("meetings")
    .select("id, title, source, started_at, draft_notes_md", { count: "exact" })
    .eq("group_id", groupId)
    .eq("status", "awaiting_review")
    .contains("recorders", JSON.stringify(draftMeetingsOwnScoped(callerId)))
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(QUEUE_LIMIT);
  if (error) {
    console.error("mcp review queue failed:", error);
    return "Ошибка: не удалось загрузить очередь вычитки.";
  }
  return formatReviewQueue((data ?? []) as QueueRow[], count ?? null);
}

export async function toolGetDraftMeeting(args: Caller & { meeting_id: string }): Promise<string> {
  const got = await loadOwnDraft(args.meeting_id, args.requesting_user_id);
  if (!got.ok) return got.msg;
  return formatDraftMeeting(got.meeting as unknown as DraftRow);
}

export async function toolUpdateDraftMeeting(
  args: Caller & { meeting_id: string; notes?: string; title?: string },
): Promise<string> {
  const got = await loadOwnDraft(args.meeting_id, args.requesting_user_id);
  if (!got.ok) return got.msg;
  if (got.meeting.status === "in_base") return "Уже опубликовано — правь запись в базе (update_entry).";
  const nowIso = new Date().toISOString();
  const upd: Record<string, unknown> = { updated_at: nowIso };
  if (typeof args.notes === "string") {
    upd.draft_notes_md = args.notes;
    // notes_edited_at — знак ручной правки: по нему арбитраж полноты не заменит вычитанные тезисы.
    upd.notes_edited_at = nowIso;
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title) upd.title = title.slice(0, TITLE_MAX);
  if (Object.keys(upd).length === 1) return "Ошибка: нужно передать notes или title.";
  const { error } = await supabase.from("meetings").update(upd).eq("id", args.meeting_id);
  if (error) {
    console.error("mcp draft update failed:", error);
    return "Ошибка: не удалось сохранить черновик.";
  }
  return "✅ Черновик обновлён.";
}

export async function toolPublishDraftMeeting(
  args: Caller & { meeting_id: string; base?: string; countries?: string[] },
): Promise<string> {
  if (args.base !== undefined && args.base !== "team" && args.base !== "personal") {
    return `Ошибка: base «${args.base}» — допустимо team или personal.`;
  }
  const got = await loadOwnDraft(args.meeting_id, args.requesting_user_id);
  if (!got.ok) return got.msg;
  const { data: me } = await supabase.from("allowed_users").select("email")
    .eq("telegram_id", args.requesting_user_id!).maybeSingle();
  const result = await publishDraftMeeting(supabase, got.meeting, {
    groupId: got.groupId,
    telegramId: args.requesting_user_id!,
    viewerEmail: (me as { email?: string | null } | null)?.email ?? null,
    isPrivate: args.base === "personal",
    countries: args.countries,
    entryColumns: PUBLISH_COLUMNS,
  });
  if (!result.ok) return `Ошибка: ${result.message}`;
  return formatPublishOutcome(result.entry, result.status);
}

// Текст встречи для извлечения: черновик (свой) или запись в базе (видимая вызывающему).
async function meetingText(
  args: Caller & { meeting_id?: string; entry_id?: string },
): Promise<{ ok: true; text: string } | { ok: false; msg: string }> {
  if (args.meeting_id) {
    const got = await loadOwnDraft(args.meeting_id, args.requesting_user_id);
    if (!got.ok) return got;
    const notes = got.meeting.draft_notes_md as string | null;
    return notes ? { ok: true, text: notes } : { ok: false, msg: "Тезисы черновика ещё не готовы." };
  }
  if (!args.entry_id) return { ok: false, msg: "Ошибка: нужен meeting_id (черновик) или entry_id (запись в базе)." };
  const callerId = args.requesting_user_id;
  if (!callerId) return { ok: false, msg: "Ошибка: личность не определена (нужен токен коннектора)." };
  const groupId = await resolveGroupId(callerId);
  const { data } = await supabase.from("entries")
    .select("id, summary, content, is_private, owner_id, group_id").eq("id", args.entry_id).maybeSingle();
  const row = data as (EntryAccessRow & { summary: string | null; content: string | null }) | null;
  const denied = entryAccessError(args.entry_id, row, callerId, groupId ?? null);
  if (denied) return { ok: false, msg: denied };
  const text = row!.summary?.trim() || row!.content?.trim();
  return text ? { ok: true, text } : { ok: false, msg: "У записи нет текста." };
}

export async function toolExtractTasksFromMeeting(
  args: Caller & { meeting_id?: string; entry_id?: string },
): Promise<string> {
  const src = await meetingText(args);
  if (!src.ok) return src.msg;
  const extracted = (await gptExtractTasks(src.text)).slice(0, EXTRACT_MAX_TASKS);
  const proposed: ProposedTask[] = await Promise.all(extracted.map(async (t) => ({
    ...t,
    resolved_assignee: t.assignee ? (await matchAssignee(t.assignee))?.display_name ?? null : null,
  })));
  const { data: me } = await supabase.from("user_profiles").select("first_name, last_name")
    .eq("telegram_id", args.requesting_user_id!).maybeSingle();
  const p = me as { first_name?: string | null; last_name?: string | null } | null;
  const callerName = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "ты";
  return formatProposedTasks(proposed, callerName);
}

const IDENTITY = { type: "number", description: "Заполняется из токена" };
const MEETING_ID = { type: "string", description: "id черновика из get_review_queue" };

export const MEETING_REVIEW_TOOL_DEFINITIONS = [
  {
    name: "get_review_queue",
    description:
      "Очередь вычитки: черновики встреч, которые записал ты и которые ещё не опубликованы в базу. У каждого печатается id. Чужие черновики не видны никому, включая владельца.",
    inputSchema: { type: "object", properties: { requesting_user_id: IDENTITY } },
  },
  {
    name: "get_draft_meeting",
    description: "Открыть черновик встречи: название, время, участники, тезисы.",
    inputSchema: {
      type: "object",
      properties: { meeting_id: MEETING_ID, requesting_user_id: IDENTITY },
      required: ["meeting_id"],
    },
  },
  {
    name: "update_draft_meeting",
    description:
      "Поправить черновик до публикации: тезисы (notes, markdown целиком — заменяют прежние) и/или название. Правленые тезисы считаются вычитанными человеком.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: MEETING_ID,
        notes: { type: "string", description: "Новые тезисы целиком (markdown)" },
        title: { type: "string", description: "Новое название встречи" },
        requesting_user_id: IDENTITY,
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "publish_draft_meeting",
    description:
      "Опубликовать черновик в базу знаний (то же, что «Согласовать» в вебе). Если эта встреча уже лежит в базе, черновик привязывается к ней, а остаётся более полная версия. По умолчанию — в базу команды.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: MEETING_ID,
        base: { type: "string", enum: ["team", "personal"], description: "team — база команды (по умолчанию), personal — личная" },
        countries: {
          type: "array",
          items: { type: "string" },
          description:
            "Рынки на английском (Serbia, Croatia…). Не передан — определит классификатор по тезисам. Пустой список — «Общее»",
        },
        requesting_user_id: IDENTITY,
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "extract_tasks_from_meeting",
    description:
      "Предложить задачи по тезисам встречи — тем же экстрактором, что кнопка «Сгенерировать» в вебе. Ничего не создаёт: покажи список человеку и заведи согласованные через add_task. Источник — черновик (meeting_id) или запись в базе (entry_id).",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string", description: "id черновика из get_review_queue" },
        entry_id: { type: "string", description: "id записи-встречи в базе (из get_meetings / search_knowledge)" },
        requesting_user_id: IDENTITY,
      },
    },
  },
];
