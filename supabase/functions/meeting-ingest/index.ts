import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

// meeting-ingest — заливка транскрипта (только claimer; см. 10-REVISED-DESIGN.md §4, §7.2).
// Сохраняет транскрипт и асинхронно генерит тезисы → meetings.draft_notes_md (черновик,
// НЕ в базе знаний). Уведомляет записавших «готово к вычитке». Запись entries создаётся
// позже, на аппруве (отдельный эндпоинт). 202/processing — чтобы не упереться в wall-clock
// и не словить дубли от retry агента.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

// Supabase-инъектируемый глобал для фоновой работы после ответа.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Segment { start: number; end: number; text: string }
interface IngestBody {
  meeting_id: string;
  transcript: { language?: string; model?: string; segments: Segment[] };
}
interface RecorderEntry { telegram_id: number; claimed_at: string; role: string }
interface InlineButton { text: string; url: string }

const TEZIS_SYSTEM =
  "Ты помощник команды. Создай структурированные тезисы встречи строго по тексту стенограммы — " +
  "не домысливай и не добавляй информацию которой нет в тексте.\n" +
  "Формат: ### Тема\n- тезис\n- тезис\n\n" +
  "Темы называй широко: 'Персонал', 'IT / Технические проблемы', 'Поставки', 'Финансы / Эквайринг', " +
  "'Строительство', 'Маркетинг', 'Операции', 'Региональные новости' и т.п. " +
  "Только то что реально обсуждалось. Без выдумок.";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function validate(raw: unknown): IngestBody {
  if (typeof raw !== "object" || raw === null) throw new Error("body must be an object");
  const b = raw as Record<string, unknown>;
  if (typeof b.meeting_id !== "string" || b.meeting_id.length === 0) {
    throw new Error("meeting_id required");
  }
  const t = b.transcript;
  if (typeof t !== "object" || t === null) throw new Error("transcript required");
  const segments = (t as Record<string, unknown>).segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("transcript.segments must be a non-empty array");
  }
  const parsed: Segment[] = segments.map((s) => {
    const o = s as Record<string, unknown>;
    if (typeof o.text !== "string") throw new Error("transcript.segments[].text must be a string");
    return {
      start: typeof o.start === "number" ? o.start : 0,
      end: typeof o.end === "number" ? o.end : 0,
      text: o.text,
    };
  });
  const meta = t as Record<string, unknown>;
  return {
    meeting_id: b.meeting_id,
    transcript: {
      language: typeof meta.language === "string" ? meta.language : undefined,
      model: typeof meta.model === "string" ? meta.model : undefined,
      segments: parsed,
    },
  };
}

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 3000,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
  }
  return (data as { choices: Array<{ message: { content: string } }> }).choices[0].message.content;
}

async function sendTelegram(
  chatId: number,
  text: string,
  keyboard?: InlineButton[][],
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  });
}

// Фоновая работа: генерим тезисы из транскрипта → draft_notes_md, уведомляем записавших.
async function generateAndNotify(
  meetingId: string,
  title: string | null,
  transcriptText: string,
  recorders: RecorderEntry[],
): Promise<void> {
  const tezisi = await chatComplete(
    TEZIS_SYSTEM,
    `Встреча: ${title ?? "без названия"}\n\nСтенограмма:\n${transcriptText.slice(0, 100000)}`,
  );

  await supabase
    .from("meetings")
    .update({ draft_notes_md: tezisi, updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";
  const titleStr = title ? `: <b>${title}</b>` : "";
  const text = `📝 Тезисы встречи готовы к вычитке${titleStr}\nВозьмёт любой из участников.`;
  const keyboard: InlineButton[][] | undefined = webUrl ? [[{ text: "Открыть", url: webUrl }]] : undefined;

  for (const r of recorders) {
    await sendTelegram(r.telegram_id, text, keyboard);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return fail(e.message, e.status);
    throw e;
  }

  let body: IngestBody;
  try {
    body = validate(await req.json());
  } catch (e) {
    return fail(e instanceof Error ? e.message : "invalid body");
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, claim_owner, notes_edited_at, recorders")
    .eq("id", body.meeting_id)
    .maybeSingle();

  if (!meeting) return fail("meeting not found", 404);
  const m = meeting as {
    id: string;
    title: string | null;
    claim_owner: number | null;
    notes_edited_at: string | null;
    recorders: RecorderEntry[] | null;
  };

  // Транскрипт льёт только тот, кто держит право (claim_owner). Иначе — defer-участник.
  if (m.claim_owner !== identity.telegramId) {
    return fail("not the transcription owner for this meeting", 403);
  }

  // Сохраняем транскрипт всегда (повторная заливка перезаписывает).
  await supabase
    .from("meetings")
    .update({ transcript: body.transcript, updated_at: new Date().toISOString() })
    .eq("id", body.meeting_id);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${body.meeting_id}` : "";

  // Защита правок человека: если черновик уже правили — тезисы не перегенерируем.
  if (m.notes_edited_at) {
    return json({ ok: true, meeting_id: body.meeting_id, web_url: webUrl, summary_status: "skipped_human_edit" });
  }

  const transcriptText = body.transcript.segments.map((s) => s.text).join(" ");
  const recorders = m.recorders ?? [];
  const job = generateAndNotify(m.id, m.title, transcriptText, recorders).catch((e) => {
    console.error(`meeting-ingest: generation failed for ${m.id}:`, e);
  });

  // 202 + фоновая генерация: возвращаем сразу, тезисы досчитываются после ответа.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
    EdgeRuntime.waitUntil(job);
  } else {
    await job;
  }

  return json(
    { ok: true, meeting_id: body.meeting_id, web_url: webUrl, summary_status: "processing" },
    202,
  );
});
