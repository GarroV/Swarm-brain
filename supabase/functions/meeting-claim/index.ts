import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError, type AgentIdentity } from "../_shared/agent-auth.ts";

// meeting-claim — шаг ДО транскрибации (см. transcribator/10-REVISED-DESIGN.md §4, §7.1).
// Записывают все участники; перед запуском Whisper каждый делает claim по ключу встречи.
// Сервер отдаёт транскрибацию ПЕРВОМУ (decision=transcribe), остальным — defer.
// Здесь же: регистрируем записавшего и сохраняем его личные пометки как приватную entry.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// На сколько выдаётся право транскрибации. Истёк и транскрипта нет → claim перехватит другой.
const LEASE_TTL_SEC = 1800;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type IdentityKind = "calendar" | "room" | "manual";
type ClaimDecision = "transcribe" | "defer";
interface UserNote { ts: number; text: string }
interface Attendee { name?: string; email?: string }

interface ClaimBody {
  identity_kind: IdentityKind;
  identity_key: string;
  started_at?: string;
  ended_at?: string;
  title?: string;
  attendees?: Attendee[];
  user_notes?: UserNote[];
  agent_version?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
  }
  return (data as { data: Array<{ embedding: number[] }> }).data[0].embedding;
}

function validate(raw: unknown): ClaimBody {
  if (typeof raw !== "object" || raw === null) throw new Error("body must be an object");
  const b = raw as Record<string, unknown>;

  const kind = b.identity_kind;
  if (kind !== "calendar" && kind !== "room" && kind !== "manual") {
    throw new Error("identity_kind must be calendar|room|manual");
  }
  if (typeof b.identity_key !== "string" || b.identity_key.length === 0) {
    throw new Error("identity_key required");
  }

  let notes: UserNote[] | undefined;
  if (b.user_notes !== undefined) {
    if (!Array.isArray(b.user_notes)) throw new Error("user_notes must be an array");
    notes = b.user_notes.map((n) => {
      const o = n as Record<string, unknown>;
      if (typeof o.text !== "string") throw new Error("user_notes[].text must be a string");
      return { ts: typeof o.ts === "number" ? o.ts : 0, text: o.text };
    });
  }

  return {
    identity_kind: kind,
    identity_key: b.identity_key,
    started_at: typeof b.started_at === "string" ? b.started_at : undefined,
    ended_at: typeof b.ended_at === "string" ? b.ended_at : undefined,
    title: typeof b.title === "string" ? b.title : undefined,
    attendees: Array.isArray(b.attendees) ? (b.attendees as Attendee[]) : undefined,
    user_notes: notes,
    agent_version: typeof b.agent_version === "string" ? b.agent_version : undefined,
  };
}

function formatTs(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface RecorderEntry { telegram_id: number; claimed_at: string; role: ClaimDecision }

// Регистрируем записавшего в meetings.recorders. Read-modify-write: при низкой
// одновременности достаточно; гонка двух одновременных claim'ов теоретически может
// потерять одну запись в массиве — приемлемо для MVP (важна сама встреча, не точный список).
async function registerRecorder(
  meetingId: string,
  telegramId: number,
  role: ClaimDecision,
  nowIso: string,
): Promise<void> {
  const { data } = await supabase.from("meetings").select("recorders").eq("id", meetingId).single();
  const recorders = ((data as { recorders?: RecorderEntry[] } | null)?.recorders) ?? [];
  if (recorders.some((r) => r.telegram_id === telegramId)) return;
  const next: RecorderEntry[] = [...recorders, { telegram_id: telegramId, claimed_at: nowIso, role }];
  await supabase.from("meetings").update({ recorders: next, updated_at: nowIso }).eq("id", meetingId);
}

// Личные пометки участника → приватная entry (is_private, owner_id) с metadata.meeting_id.
// Идемпотентно: повторный claim обновляет ту же entry, а не плодит копии.
async function savePersonalNotes(
  meetingId: string,
  identity: AgentIdentity,
  notes: UserNote[],
  title: string | undefined,
): Promise<void> {
  const flat = notes.map((n) => `[${formatTs(n.ts)}] ${n.text}`).join("\n");
  const summary = `Личные пометки со встречи${title ? `: ${title}` : ""}`;
  const embedding = await getEmbedding(flat);
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .from("entries")
    .select("id")
    .eq("owner_id", identity.telegramId)
    .eq("metadata->>meeting_id", meetingId)
    .eq("metadata->>kind", "personal_notes")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("entries")
      .update({ content: flat, summary, embedding, updated_at: nowIso })
      .eq("id", (existing as { id: string }).id);
    return;
  }

  await supabase.from("entries").insert({
    content: flat,
    summary,
    embedding,
    added_by: String(identity.telegramId),
    source: "desktop-agent",
    entry_type: "note", // личные пометки участника — заметка (фасет kind=personal_notes)
    metadata: { meeting_id: meetingId, kind: "personal_notes" },
    group_id: identity.groupId,
    is_private: true,
    owner_id: identity.telegramId,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let identity: AgentIdentity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return fail(e.message, e.status);
    throw e;
  }
  if (!identity.groupId) {
    return fail("user has no workspace (group_id) — contact admin", 403);
  }

  let body: ClaimBody;
  try {
    body = validate(await req.json());
  } catch (e) {
    return fail(e instanceof Error ? e.message : "invalid body");
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseIso = new Date(nowMs + LEASE_TTL_SEC * 1000).toISOString();

  const baseRow = {
    source: "desktop-agent",
    identity_kind: body.identity_kind,
    identity_key: body.identity_key,
    title: body.title ?? null,
    started_at: body.started_at ?? null,
    ended_at: body.ended_at ?? null,
    attendees: body.attendees ?? [],
    group_id: identity.groupId,
    agent_version: body.agent_version ?? null,
  };

  let meetingId: string;
  let decision: ClaimDecision;

  if (body.identity_kind === "manual") {
    // Telegram/кнопка — без дедупа, всегда новая встреча, всегда транскрибируем сами.
    const { data, error } = await supabase
      .from("meetings")
      .insert({ ...baseRow, claim_owner: identity.telegramId, lease_expires_at: leaseIso })
      .select("id")
      .single();
    if (error || !data) return fail(`create failed: ${error?.message ?? "unknown"}`, 500);
    meetingId = (data as { id: string }).id;
    decision = "transcribe";
  } else {
    // calendar/room — дедуп по identity_key. Пытаемся создать как claimer;
    // уникальный индекс meetings_identity_key_uq детерминированно разрешает гонку.
    const { data: created, error: insErr } = await supabase
      .from("meetings")
      .insert({ ...baseRow, claim_owner: identity.telegramId, lease_expires_at: leaseIso })
      .select("id")
      .maybeSingle();

    if (created) {
      meetingId = (created as { id: string }).id;
      decision = "transcribe";
    } else if (insErr && insErr.code === "23505") {
      // Встреча уже есть (другой создал) → оцениваем lease атомарным условным апдейтом.
      const { data: existing } = await supabase
        .from("meetings")
        .select("id")
        .eq("identity_key", body.identity_key)
        .single();
      if (!existing) return fail("claim conflict but meeting not found", 409);
      meetingId = (existing as { id: string }).id;

      const { data: claimed } = await supabase
        .from("meetings")
        .update({ claim_owner: identity.telegramId, lease_expires_at: leaseIso, updated_at: nowIso })
        .eq("id", meetingId)
        .is("transcript", null)
        .or(`claim_owner.is.null,lease_expires_at.lt.${nowIso}`)
        .select("id")
        .maybeSingle();

      decision = claimed ? "transcribe" : "defer";
    } else {
      return fail(`create failed: ${insErr?.message ?? "unknown"}`, 500);
    }
  }

  await registerRecorder(meetingId, identity.telegramId, decision, nowIso);

  // Личные пометки — best-effort: их сбой не должен валить координацию транскрибации.
  if (body.user_notes && body.user_notes.length > 0) {
    try {
      await savePersonalNotes(meetingId, identity, body.user_notes, body.title);
    } catch (e) {
      console.error(`meeting-claim: failed to save personal notes for ${meetingId}:`, e);
    }
  }

  return json({ meeting_id: meetingId, decision, lease_ttl_sec: LEASE_TTL_SEC });
});
