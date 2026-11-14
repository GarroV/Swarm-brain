import { onlyLiveEntries } from "../_shared/entries/live.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { loadManualMeeting, manualMeetingGroupIds, ManualMergeError } from "../_shared/manual-meeting-merge.ts";

/** Called only after the unchanged draft/current-entry guard in the main meeting route. */
export async function handleMeetingLiveNotes(ctx: {
  supabase: SupabaseClient;
  req: Request;
  origin: string;
  meetingId: string;
  groupId: string;
  telegramId: number;
  actorEmail?: string | null;
  resolveNames: (ids: number[]) => Promise<Map<number, string>>;
  serverError: (origin: string, label: string, error: unknown) => Response;
}): Promise<Response> {
  const { supabase, req, origin, meetingId: mId, groupId: meetingGroupId, telegramId: telegram_id } = ctx;
  if (req.method === "GET") {
    const ids = await manualMeetingGroupIds(supabase, [mId]);
    const recordings = new Map<string, string | null>();
    for (const id of ids) {
      try {
        const row = await loadManualMeeting(supabase, id, {
          telegramId: telegram_id,
          groupId: meetingGroupId,
          email: ctx.actorEmail,
        });
        recordings.set(id, row.started_at ?? null);
      } catch (error) {
        if (!(error instanceof ManualMergeError) || error.status !== 404) throw error;
      }
    }
    if (!recordings.size) return json([], 200, origin);
    const { data, error } = await supabase.from("meeting_live_notes")
      .select("id, meeting_id, offset_sec, text, author_id, created_at")
      .in("meeting_id", [...recordings.keys()])
      .order("offset_sec", { ascending: true });
    if (error) return ctx.serverError(origin, "agent-notes list", error);
    const names = await ctx.resolveNames([
      ...new Set((data ?? []).map((n) => Number(n.author_id)).filter(Number.isFinite)),
    ]);
    return json(
      (data ?? []).map((n) => ({
        ...n,
        author_name: names.get(n.author_id) ?? null,
        recording_started_at: recordings.get(n.meeting_id) ?? null,
      })),
      200,
      origin,
    );
  }
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiErr(400, "Invalid JSON", origin);
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return apiErr(400, "Пустая пометка", origin);
    const offsetSec = Math.max(0, Math.floor(Number(body.offset_sec) || 0));
    const { data, error } = await supabase.from("meeting_live_notes")
      .insert({
        meeting_id: mId,
        group_id: meetingGroupId,
        author_id: telegram_id,
        offset_sec: offsetSec,
        text: text.slice(0, 2000),
      })
      .select("id, offset_sec, text, author_id, created_at").single();
    if (error) return ctx.serverError(origin, "agent-notes create", error);
    return json(data, 201, origin);
  }
  return apiErr(405, "Method not allowed", origin);
}

/** Entry and its ordinary meeting visibility have already been checked by getEntrySecure. */
export async function listConfirmedMeetingNotes(ctx: {
  supabase: SupabaseClient;
  entry: { id: string; group_id?: string | null; metadata?: unknown };
  groupId: string;
  telegramId: number;
  resolveNames: (ids: number[]) => Promise<Map<number, string>>;
  origin: string;
}): Promise<Response> {
  const { supabase, entry, groupId, telegramId: telegram_id, resolveNames, origin } = ctx;
  // Все версии этой встречи: привязанные строки meetings + та, из которой запись создана
  // (entry_id проставляется при публикации, но metadata.meeting_id несёт исходную версию).
  // Пространство — ДОМАШНЕЕ встречи, а не смотрящего: у общей встречи версии и пометки
  // лежат в её доме, и вторая команда иначе увидела бы пустую карточку.
  const homeGroupId = entry.group_id ?? groupId;
  const { data: versions } = await supabase.from("meetings")
    .select(
      "id, claim_owner, source, identity_kind, started_at, recorded_seconds",
    )
    .eq("group_id", homeGroupId)
    .eq("entry_id", entry.id);
  const ids = new Set<string>(
    ((versions ?? []) as Array<{ id: string }>).map((v) => v.id),
  );
  const ownMeetingId = (entry.metadata as { meeting_id?: string } | null)
    ?.meeting_id;
  if (ownMeetingId) ids.add(ownMeetingId);
  if (ids.size === 0) {
    return json({ live: [], personal: [], versions: 0 }, 200, origin);
  }
  const idList = [...new Set([...ids, ...await manualMeetingGroupIds(supabase, [...ids])])];

  const [{ data: live }, { data: personal }] = await Promise.all([
    supabase.from("meeting_live_notes")
      .select("id, meeting_id, offset_sec, text, author_id, created_at")
      .in("meeting_id", idList)
      .order("offset_sec", { ascending: true }),
    onlyLiveEntries(
      supabase.from("entries")
        .select("id, content, created_at, metadata"),
    )
      .eq("group_id", homeGroupId)
      .eq("owner_id", telegram_id)
      .eq("metadata->>kind", "personal_notes")
      .in("metadata->>meeting_id", idList),
  ]);

  const liveRows = (live ?? []) as Array<{ author_id: number | null }>;
  const names = await resolveNames([
    ...new Set(
      liveRows.map((r) => r.author_id).filter((n): n is number => typeof n === "number"),
    ),
  ]);
  return json(
    {
      versions: idList.length,
      live: liveRows.map((r) => {
        const row = r as {
          id: string;
          meeting_id: string;
          offset_sec: number;
          text: string;
          author_id: number | null;
          created_at: string;
        };
        return {
          ...row,
          author_name: row.author_id != null ? (names.get(row.author_id) ?? `#${row.author_id}`) : null,
        };
      }),
      personal: ((personal ?? []) as Array<
        { id: string; content: string; created_at: string }
      >)
        .map((r) => ({
          id: r.id,
          content: r.content,
          created_at: r.created_at,
        })),
    },
    200,
    origin,
  );
}
