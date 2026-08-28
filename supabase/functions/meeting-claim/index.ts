import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError, type AgentIdentity } from "../_shared/agent-auth.ts";
import { sameMeetingByRoster, scopeRoomKey, ROSTER_TOLERANCE_MIN } from "../_shared/meeting-roster.ts";

// meeting-claim — шаг ДО транскрибации (см. transcribator/10-REVISED-DESIGN.md §4, §7.1).
// Записывают все участники; перед запуском Whisper каждый делает claim по ключу встречи.
// Транскрибирует ОДИН — тот, чья запись ПОЛНЕЕ (decision=transcribe), остальные — defer.
// Здесь же: регистрируем записавшего и сохраняем его личные пометки как приватную entry.
//
// Почему не «кто первый, того и тапки» (было до 17.08.2026): claim подаётся в момент ОСТАНОВКИ
// записи, поэтому «первый заявившийся» = тот, кто раньше нажал стоп = владелец САМОЙ КОРОТКОЙ
// записи. Инцидент (встреча 251cd245-d6be-4abf-ba47-9755885eb05b): коллега остановила запись на
// 3-й минуте при переходе в другой Google Meet и забрала право; полная запись на 2ч26м пришла
// через 2.5 часа, получила defer и была стёрта клиентом. В базе осталось 3 минуты возни.
// Теперь claim несёт recorded_seconds, и заметно более полная запись ПЕРЕХВАТЫВАЕТ право.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// На сколько выдаётся право транскрибации. Истёк и транскрипта нет → claim перехватит другой.
const LEASE_TTL_SEC = 1800;

// Перехват права более полной записью. Оба порога должны выполниться разом — чтобы почти
// одинаковые записи (штатный случай: все стопнули в пределах минуты) не гоняли перетранскрибацию
// туда-сюда, но провал вроде «3 минуты против 2.5 часов» закрывался гарантированно.
const TAKEOVER_MIN_RATIO = 1.5;      // новая запись длиннее текущей минимум в полтора раза
const TAKEOVER_MIN_EXTRA_SEC = 300;  // …и минимум на 5 минут в абсолюте

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
  // Сдвиг старта mic-дорожки относительно system (сек, может быть < 0). См. миграцию
  // 20260624120000_meetings_mic_start_offset.sql — ingest прибавит его к таймстампам mic.
  mic_start_offset?: number;
  // Длительность записи претендента (сек). Основа арбитража: более полная запись перехватывает
  // право у более короткой. Отсутствует у старых сборок рекордера → перехват не запрашивается.
  recorded_seconds?: number;
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

  const micOffset = b.mic_start_offset;
  const recSec = b.recorded_seconds;
  return {
    identity_kind: kind,
    identity_key: b.identity_key,
    started_at: typeof b.started_at === "string" ? b.started_at : undefined,
    ended_at: typeof b.ended_at === "string" ? b.ended_at : undefined,
    title: typeof b.title === "string" ? b.title : undefined,
    attendees: Array.isArray(b.attendees) ? (b.attendees as Attendee[]) : undefined,
    user_notes: notes,
    agent_version: typeof b.agent_version === "string" ? b.agent_version : undefined,
    mic_start_offset: typeof micOffset === "number" && Number.isFinite(micOffset) ? micOffset : undefined,
    recorded_seconds:
      typeof recSec === "number" && Number.isFinite(recSec) && recSec > 0 ? recSec : undefined,
  };
}

function formatTs(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// role=superseded — запись, у которой право транскрибации отобрала более полная (см. арбитраж).
type RecorderRole = ClaimDecision | "superseded";
interface RecorderEntry { telegram_id: number; claimed_at: string; role: RecorderRole; recorded_seconds?: number }

// Регистрируем записавшего в meetings.recorders. Read-modify-write: при низкой
// одновременности достаточно; гонка двух одновременных claim'ов теоретически может
// потерять одну запись в массиве — приемлемо для MVP (важна сама встреча, не точный список).
// Повторный claim того же человека ОБНОВЛЯЕТ его строку (роль могла смениться defer→transcribe),
// а при перехвате прежний владелец переводится в superseded — иначе в массиве осталось бы два
// «transcribe» и по нему нельзя было бы понять, чьё аудио реально в базе.
async function registerRecorder(
  meetingId: string,
  telegramId: number,
  role: RecorderRole,
  nowIso: string,
  recordedSeconds: number | undefined,
  supersedeOwner?: number | null,
): Promise<void> {
  const { data } = await supabase.from("meetings").select("recorders").eq("id", meetingId).single();
  const recorders = ((data as { recorders?: RecorderEntry[] } | null)?.recorders) ?? [];
  const next: RecorderEntry[] = recorders.map((r) =>
    supersedeOwner != null && r.telegram_id === supersedeOwner && r.role === "transcribe"
      ? { ...r, role: "superseded" as RecorderRole }
      : r
  );
  const mine: RecorderEntry = {
    telegram_id: telegramId,
    claimed_at: nowIso,
    role,
    ...(recordedSeconds !== undefined ? { recorded_seconds: recordedSeconds } : {}),
  };
  const at = next.findIndex((r) => r.telegram_id === telegramId);
  if (at >= 0) next[at] = { ...next[at], ...mine };
  else next.push(mine);
  await supabase.from("meetings").update({ recorders: next, updated_at: nowIso }).eq("id", meetingId);
}

// Длительность записи, которая СЕЙЧАС лежит за встречей (сек). Для строк, заведённых старым
// клиентом, recorded_seconds пуст — оцениваем по последнему таймстампу сохранённого транскрипта.
// Это позволяет перехватить право у записи старой сборки, не дожидаясь обновления всей команды.
function heldSeconds(row: { recorded_seconds?: number | null; transcript?: { segments?: Array<{ end?: number }> } | null }): number {
  if (typeof row.recorded_seconds === "number" && Number.isFinite(row.recorded_seconds)) {
    return row.recorded_seconds;
  }
  const segs = row.transcript?.segments ?? [];
  let max = 0;
  for (const s of segs) {
    const e = typeof s?.end === "number" && Number.isFinite(s.end) ? s.end : 0;
    if (e > max) max = e;
  }
  return max;
}

// Заметно ли претендент полнее того, что уже есть. Оба порога разом — см. константы.
function isSubstantiallyLonger(candidate: number, held: number): boolean {
  return candidate >= held * TAKEOVER_MIN_RATIO && candidate >= held + TAKEOVER_MIN_EXTRA_SEC;
}

// E-mail участника по telegram_id — нужен, чтобы понять «а этот человек есть в списке участников
// той встречи?». Единственный доступный серверу признак для записи из комнаты: у неё нет ни
// названия, ни attendees, но сам записавший в календарном списке другой стороны присутствует.
async function emailOfUser(telegramId: number | null | undefined): Promise<string | null> {
  if (telegramId == null) return null;
  const { data } = await supabase.from("allowed_users").select("email").eq("telegram_id", telegramId).maybeSingle();
  return ((data as { email?: string | null } | null)?.email ?? null);
}

type ExistingMeetingRow = {
  id: string;
  claim_owner: number | null;
  recorded_seconds: number | null;
  transcript: { segments?: Array<{ end?: number }> } | null;
  notes_edited_at: string | null;
  status: string | null;
};

type RosterCandidate = ExistingMeetingRow & {
  identity_key: string | null;
  started_at: string | null;
  attendees: Attendee[] | null;
  created_at: string | null;
};

/**
 * Та же встреча под ДРУГИМ ключом идентичности (issue #168). Ключ описывает не встречу, а то, как
 * её увидел клиент: участник с событием в календаре присылает `<event>:<дата>`, участник по ссылке
 * — `kontur:<room>`. Уникальный индекс такую пару не видит, и claim открывал вторую встречу: два
 * аудио, ДВЕ транскрибации, два черновика (26.08 «IT+BD» — три записи в базе).
 *
 * Сопоставляем по времени + людям (`sameMeetingByRoster`); одного времени мало — в одну минуту
 * идут разные созвоны. Кандидатов ограничиваем днём и воркспейсом.
 */
async function findMeetingByRoster(
  groupId: string,
  body: ClaimBody,
  myEmail: string | null,
  scopedKey: string,
): Promise<{ row: RosterCandidate; reason: string } | null> {
  if (!body.started_at) return null;
  const startMs = new Date(body.started_at).getTime();
  if (isNaN(startMs)) return null;
  const from = new Date(startMs - ROSTER_TOLERANCE_MIN * 60000).toISOString();
  const to = new Date(startMs + ROSTER_TOLERANCE_MIN * 60000).toISOString();

  const { data } = await supabase
    .from("meetings")
    .select("id, identity_key, started_at, attendees, claim_owner, recorded_seconds, transcript, notes_edited_at, status, created_at")
    .eq("group_id", groupId)
    .gte("started_at", from)
    .lte("started_at", to)
    .order("created_at", { ascending: true })
    .limit(20);
  const candidates = ((data ?? []) as RosterCandidate[]).filter((c) => c.identity_key !== scopedKey);
  if (candidates.length === 0) return null;

  const incoming = { startedAt: body.started_at ?? null, attendees: body.attendees ?? [], ownerEmail: myEmail };
  for (const c of candidates) {
    const candEmail = await emailOfUser(c.claim_owner);
    const verdict = sameMeetingByRoster(incoming, {
      startedAt: c.started_at,
      attendees: c.attendees ?? [],
      ownerEmail: candEmail,
    });
    if (verdict.same) return { row: c, reason: verdict.reason };
  }
  return null;
}

/**
 * Что делать с уже существующей строкой встречи: занять свободную, перехватить заметно более
 * полной записью или отступить. Вынесено из ветки конфликта уникального индекса, чтобы тем же
 * правилом обрабатывалась и встреча, найденная по составу (иначе арбитраж «полнее, а не первее»
 * действовал бы только на одном из двух путей — ровно так и разъехались claim и публикация).
 */
async function resolveExisting(
  row: ExistingMeetingRow,
  body: ClaimBody,
  identity: AgentIdentity,
  nowIso: string,
  leaseIso: string,
): Promise<{ decision: ClaimDecision; supersededOwner: number | null; heldBy: number | null }> {
  let heldBy = row.claim_owner;

  // (1) Свободна (никто не держит / лиз истёк и транскрипта нет) — занимаем.
  const { data: claimed } = await supabase
    .from("meetings")
    .update({
      claim_owner: identity.telegramId,
      lease_expires_at: leaseIso,
      updated_at: nowIso,
      mic_start_offset: body.mic_start_offset ?? null,
      recorded_seconds: body.recorded_seconds ?? null,
    })
    .eq("id", row.id)
    .is("transcript", null)
    .or(`claim_owner.is.null,lease_expires_at.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  if (claimed) return { decision: "transcribe", supersededOwner: null, heldBy: identity.telegramId };

  // (2) Занята. Перехватываем, только если НАША запись заметно полнее — и не трогаем то, что
  // правил человек или уже опубликовали команде.
  const candidate = body.recorded_seconds ?? 0;
  const held = heldSeconds(row);
  const protectedRow = row.notes_edited_at !== null || row.status === "in_base";
  if (!(candidate > 0 && !protectedRow && isSubstantiallyLonger(candidate, held))) {
    return { decision: "defer", supersededOwner: null, heldBy };
  }

  // Сбрасываем ТОЛЬКО маркеры обработки: transcript/draft_notes_md остаются до прихода нового аудио.
  const { data: took } = await supabase
    .from("meetings")
    .update({
      claim_owner: identity.telegramId,
      lease_expires_at: leaseIso,
      updated_at: nowIso,
      mic_start_offset: body.mic_start_offset ?? null,
      recorded_seconds: candidate,
      summary_status: null,
      process_state: null,
      processing_lease: null,
      last_progress_at: null,
    })
    .eq("id", row.id)
    .eq("claim_owner", row.claim_owner)   // никто не перехватил, пока мы считали
    .select("id")
    .maybeSingle();
  if (!took) return { decision: "defer", supersededOwner: null, heldBy };

  heldBy = identity.telegramId;
  console.log(
    `meeting-claim: перехват ${row.id} — ${Math.round(candidate)}с у ${identity.telegramId} против ${Math.round(held)}с у ${row.claim_owner}`,
  );
  return { decision: "transcribe", supersededOwner: row.claim_owner, heldBy };
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
    mic_start_offset: body.mic_start_offset ?? null,
    recorded_seconds: body.recorded_seconds ?? null,
  };

  let meetingId: string;
  let decision: ClaimDecision;
  // Кого перехватили (для recorders) и кто держит право, если нам отказали (для сообщения юзеру).
  let supersededOwner: number | null = null;
  let heldBy: number | null = null;

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
    // calendar/room. Три пути, по возрастанию сложности:
    //   1) точный ключ — уникальный индекс meetings_identity_key_uq детерминированно разрешает гонку;
    //   2) та же встреча под ДРУГИМ ключом (участник с событием в календаре ⨯ участник по ссылке) —
    //      сопоставление по времени и составу, иначе открывалась вторая встреча с отдельным аудио,
    //      отдельной транскрибацией и отдельным черновиком (issue #168);
    //   3) ничего не нашли — создаём новую.
    // Комнатный ключ сужаем до дня: у регулярной встречи ссылка одна на всю серию, а индекс
    // глобальный — без дневного суффикса второй созвон в той же комнате получал defer и не
    // записывался вовсе (issue #181). Сужает СЕРВЕР: у команды стоят разные сборки рекордера.
    const scopedKey = scopeRoomKey(body.identity_kind, body.identity_key, body.started_at ?? null);
    const myEmail = await emailOfUser(identity.telegramId);

    // (2) до вставки: вдруг эта встреча уже открыта под другим ключом.
    const joined = await findMeetingByRoster(identity.groupId, body, myEmail, scopedKey);
    if (joined) {
      meetingId = joined.row.id;
      const res = await resolveExisting(joined.row, body, identity, nowIso, leaseIso);
      decision = res.decision;
      supersededOwner = res.supersededOwner;
      heldBy = res.heldBy;
      console.log(
        `meeting-claim: склейка по составу ${meetingId} (${joined.reason}) — ключ ${scopedKey} присоединён к ${joined.row.identity_key}, решение ${decision}`,
      );
    } else {
      const { data: created, error: insErr } = await supabase
        .from("meetings")
        .insert({ ...baseRow, identity_key: scopedKey, claim_owner: identity.telegramId, lease_expires_at: leaseIso })
        .select("id")
        .maybeSingle();

      if (created) {
        meetingId = (created as { id: string }).id;
        decision = "transcribe";
        // Гонка: пока мы искали, другой участник мог открыть ту же встречу под своим ключом.
        // Ищем ещё раз и, если нашлась строка, созданная РАНЬШЕ нашей, отдаём ей право, а свою
        // пустую (только что созданную, без транскрипта) убираем — иначе в базе останется дубль,
        // который потом придётся склеивать на публикации.
        const rival = await findMeetingByRoster(identity.groupId, body, myEmail, scopedKey);
        if (rival && rival.row.id !== meetingId) {
          await supabase.from("meetings").delete().eq("id", meetingId).is("transcript", null);
          meetingId = rival.row.id;
          const res = await resolveExisting(rival.row, body, identity, nowIso, leaseIso);
          decision = res.decision;
          supersededOwner = res.supersededOwner;
          heldBy = res.heldBy;
          console.log(`meeting-claim: гонка склейки — свою строку убрал, присоединился к ${meetingId} (${rival.reason}), решение ${decision}`);
        }
      } else if (insErr && insErr.code === "23505") {
        // Встреча с этим ключом уже есть → решаем по тому же правилу, что и при склейке.
        const { data: existing } = await supabase
          .from("meetings")
          .select("id, claim_owner, recorded_seconds, transcript, notes_edited_at, status")
          .eq("identity_key", scopedKey)
          .single();
        if (!existing) return fail("claim conflict but meeting not found", 409);
        const row = existing as ExistingMeetingRow;
        meetingId = row.id;
        const res = await resolveExisting(row, body, identity, nowIso, leaseIso);
        decision = res.decision;
        supersededOwner = res.supersededOwner;
        heldBy = res.heldBy;
      } else {
        return fail(`create failed: ${insErr?.message ?? "unknown"}`, 500);
      }
    }
  }

  // Решение claim видно в логах ВСЕГДА: «запись не понадобилась» и «записи не было» иначе
  // неотличимы, и мёртвая ветка арбитража могла месяцами не срабатывать незамеченной
  // (docs/decisions/2026-08-28-fullness-over-recency.md, мера №3).
  console.log(
    `meeting-claim: ${decision} ${meetingId} kind=${body.identity_kind} sec=${Math.round(body.recorded_seconds ?? 0)} by=${identity.telegramId} heldBy=${heldBy ?? "—"}`,
  );

  await registerRecorder(meetingId, identity.telegramId, decision, nowIso, body.recorded_seconds, supersededOwner);

  // Личные пометки — best-effort: их сбой не должен валить координацию транскрибации.
  if (body.user_notes && body.user_notes.length > 0) {
    try {
      await savePersonalNotes(meetingId, identity, body.user_notes, body.title);
    } catch (e) {
      console.error(`meeting-claim: failed to save personal notes for ${meetingId}:`, e);
    }
  }

  // При отказе называем, кто держит право: клиент показывает это пользователю вместо молчания
  // («эту встречу пишет @аня — твоя запись в базу не пойдёт»), см. #24/#25.
  let heldByName: string | null = null;
  if (decision === "defer" && heldBy !== null && heldBy !== identity.telegramId) {
    const { data: holder } = await supabase
      .from("allowed_users")
      .select("username")
      .eq("telegram_id", heldBy)
      .maybeSingle();
    heldByName = (holder as { username?: string } | null)?.username ?? null;
  }

  return json({
    meeting_id: meetingId,
    decision,
    lease_ttl_sec: LEASE_TTL_SEC,
    held_by: heldBy,
    held_by_name: heldByName,
  });
});
