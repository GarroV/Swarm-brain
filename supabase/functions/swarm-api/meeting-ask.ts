import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { EntryAccessError, getEntrySecure } from "./entries-guard.ts";
import { canAccessDraftMeeting, type DraftMeetingRow } from "../_shared/meeting-access.ts";
import { answerMeetingQuestion, MeetingAskError, parseMeetingAskBody } from "../_shared/meeting-ask.ts";

// Точечный вопрос по встрече (логика и промпт — `_shared/meeting-ask.ts`):
//   POST /agent-meetings/:id/ask — черновик на вычитке (:id = meetings.id)
//   POST /meetings/:id/ask       — опубликованная встреча (:id = entries.id, транскрипт по
//                                  metadata.meeting_id)
// Тело { fragment, question? } → { answer } — пункты «- …». В базу не пишет ничего.
//
// Доступ одинаковый в обоих случаях: спрашивать может только тот, кто записывал встречу, или
// совладелец — правило черновика (`canAccessDraftMeeting`). Ответ пересказывает транскрипт, а у
// опубликованной встречи коллеги видят только тезисы: иначе вопрос стал бы обходным путём к
// чужой сырой записи. Возвращает null, если путь не про вопрос.

const AGENT_ASK = /^\/agent-meetings\/([^/]+)\/ask$/;
const ENTRY_ASK = /^\/meetings\/([^/]+)\/ask$/;

export async function handleMeetingAskRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "POST") return null;
  const agentMatch = routePath.match(AGENT_ASK);
  const entryMatch = agentMatch ? null : routePath.match(ENTRY_ASK);
  if (!agentMatch && !entryMatch) return null;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiErr(400, "Invalid JSON", origin);
  }
  const input = parseMeetingAskBody(body);
  if ("error" in input) return apiErr(400, input.error, origin);

  let meetingId: string | null;
  try {
    meetingId = agentMatch ? agentMatch[1] : await meetingIdOfEntry(supabase, entryMatch![1], telegramId, groupId);
  } catch (e) {
    if (e instanceof EntryAccessError) return apiErr(e.status, e.message, origin);
    throw e;
  }
  if (!meetingId) return apiErr(400, "У записи нет транскрипта встречи — спросить не по чему", origin);

  const { data: row } = await supabase.from("meetings").select("group_id, recorders, co_owners")
    .eq("id", meetingId).maybeSingle();
  if (!canAccessDraftMeeting(row as DraftMeetingRow | null, telegramId, isAdmin, groupId)) {
    return apiErr(404, "Not found", origin);
  }

  try {
    const answer = await answerMeetingQuestion(supabase, meetingId, input);
    return json({ answer }, 200, origin);
  } catch (e) {
    if (e instanceof MeetingAskError) return apiErr(e.status, e.message, origin);
    console.error("meeting-ask: модель не ответила", e);
    return apiErr(502, "Не удалось получить ответ — попробуй ещё раз", origin);
  }
}

/** meetings.id опубликованной встречи; бросает EntryAccessError, если запись не видна. */
async function meetingIdOfEntry(
  supabase: SupabaseClient,
  entryId: string,
  telegramId: number,
  groupId: string,
): Promise<string | null> {
  const entry = await getEntrySecure(supabase, entryId, { groupId, telegramId });
  return (entry.metadata as { meeting_id?: string } | null)?.meeting_id ?? null;
}
