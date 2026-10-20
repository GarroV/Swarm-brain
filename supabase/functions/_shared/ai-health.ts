// Здоровье ключа к нейронке (#233): сигнал «ключ перестал работать» админам пространства.
//
// Единая точка — `noteOpenAIResponse` в workspace-keys.ts: каждый ответ OpenAI, пришедший по ключу
// (своему пространства ИЛИ общему серверному), классифицируется и ложится в `ai_key_health`.
// Не реагируем на единичные дрожания (решение владельца 19.10.2026: «не при любом малейшем
// дрыгании API»):
//   • жёсткий сбой — сразу: 401 (ключ не принят) и 429 с кодом квоты/биллинга (кончились деньги);
//   • мягкий (5xx, таймаут, 429 без кода квоты) — тревога, только если держится: не меньше
//     SOFT_MIN_FAILURES подряд, растянутых не меньше чем на SOFT_MIN_SPAN_MS, без успеха между ними.
// Telegram админам пространства — по пути `notifyPerson` (комендантский час уважается), не чаще
// раза в ALERT_COOLDOWN_MS на пространство. Баннер в вебе — `keyIssues` (`GET /admin/ai-health`),
// гаснет первым успешным вызовом.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPerson } from "./notify-person.ts";
import { listMasterAdmins } from "./users/master-admins.ts";

/** Сколько мягких сбоев подряд нужно для тревоги… */
export const SOFT_MIN_FAILURES = 3;
/** …и на какое время они должны растянуться (первый — последний), мс. */
export const SOFT_MIN_SPAN_MS = 10 * 60_000;
/** Не чаще одного письма на пространство за это время, мс. */
export const ALERT_COOLDOWN_MS = 24 * 3_600_000;
/** Здоровый ключ перепроверяем в базе не чаще раза за это время, мс (иначе запись на каждый вызов). */
export const HEALTHY_CACHE_MS = 60_000;
/** Встреча в обработке без движения дольше этого — «встало», показываем в баннере, мин. */
export const STALL_MINUTES = 30;

const TABLE = "ai_key_health";
const QUOTA_CODES = ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active"];

export type FailureReason = "rejected" | "quota" | "errors";
export type KeySource = "workspace" | "server";
export type Outcome =
  | { kind: "ok" }
  | { kind: "hard"; reason: "rejected" | "quota" }
  | { kind: "soft" }
  | { kind: "ignore" };

export type HealthRow = {
  group_id: string;
  source: KeySource;
  failing: boolean;
  reason: FailureReason | null;
  consecutive_failures: number;
  first_failure_at: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
  last_alert_at: string | null;
};

/** Статус ответа (и код ошибки из тела для 429) → что это значит для ключа. */
export function classifyResponse(status: number, errorCode?: string | null): Outcome {
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 401) return { kind: "hard", reason: "rejected" };
  if (status === 429) {
    return errorCode && QUOTA_CODES.includes(errorCode) ? { kind: "hard", reason: "quota" } : { kind: "soft" };
  }
  if (status >= 500) return { kind: "soft" };
  return { kind: "ignore" }; // 4xx про запрос, а не про ключ: ни сбой, ни доказательство здоровья
}

const blank = (groupId: string, source: KeySource): HealthRow => ({
  group_id: groupId,
  source,
  failing: false,
  reason: null,
  consecutive_failures: 0,
  first_failure_at: null,
  last_failure_at: null,
  last_success_at: null,
  last_alert_at: null,
});

/** Чистое решение: новое состояние строки и пора ли слать письмо. `ignore` состояние не трогает. */
export function nextHealth(
  prev: HealthRow | null,
  outcome: Outcome,
  now: Date,
  groupId = prev?.group_id ?? "",
  source: KeySource = prev?.source ?? "server",
): { row: HealthRow; alertDue: boolean } {
  const base = prev ?? blank(groupId, source);
  const iso = now.toISOString();
  if (outcome.kind === "ignore") return { row: base, alertDue: false };
  if (outcome.kind === "ok") {
    return {
      row: {
        ...base,
        failing: false,
        reason: null,
        consecutive_failures: 0,
        first_failure_at: null,
        last_success_at: iso,
      },
      alertDue: false,
    };
  }
  let row: HealthRow;
  if (outcome.kind === "hard") {
    row = {
      ...base,
      failing: true,
      reason: outcome.reason,
      consecutive_failures: base.consecutive_failures + 1,
      first_failure_at: base.first_failure_at ?? iso,
      last_failure_at: iso,
    };
  } else {
    const first = base.first_failure_at ?? iso;
    const count = base.consecutive_failures + 1;
    const persistent = count >= SOFT_MIN_FAILURES && now.getTime() - new Date(first).getTime() >= SOFT_MIN_SPAN_MS;
    row = {
      ...base,
      failing: base.failing || persistent,
      reason: base.failing ? base.reason : persistent ? "errors" : null,
      consecutive_failures: count,
      first_failure_at: first,
      last_failure_at: iso,
    };
  }
  const cooled = !row.last_alert_at || now.getTime() - new Date(row.last_alert_at).getTime() >= ALERT_COOLDOWN_MS;
  return { row, alertDue: row.failing && cooled };
}

/** Текст письма — слово в слово как утвердил владелец (19.10.2026). */
export function alertText(workspaceName: string, lang: "ru" | "en"): string {
  return lang === "en"
    ? `The AI key for workspace «${workspaceName}» has stopped working. Update it: Settings → Workspace.`
    : `Ключ нейросети в пространстве «${workspaceName}» перестал работать. Обновите его: Настройки → Пространство.`;
}

// ── хранение ────────────────────────────────────────────────────────────────

const SERVER_REASON_RU: Record<FailureReason, string> = {
  rejected: "ключ отклонён",
  quota: "закончились деньги или квота",
  errors: "ошибки не проходят",
};

/** Письмо мастер-админам об общем ключе сервера (решение безопасности 19.10.2026: не админам пространств). */
export function serverAlertText(reason: FailureReason): string {
  return `Общий ключ нейросети перестал работать (${
    SERVER_REASON_RU[reason]
  }). Пространства без своего ключа сейчас без обработки.`;
}

/** Строка, на которой считается суточный кулдаун письма об общем ключе — одна на все пространства. */
const SERVER_ALERT_GROUP = "";

const healthy = new Map<string, number>(); // "group|source" → до какого момента считаем здоровым без проверки
export function resetHealthCache(): void {
  healthy.clear();
}
const scopeKey = (g: string, s: KeySource) => `${g}|${s}`;

export type SendText = (telegramId: number, text: string) => Promise<void>;
const defaultSend = (supabase: SupabaseClient): SendText => async (recipientId, text) => {
  await notifyPerson(supabase, {
    recipientId,
    kind: "ai_key_failure",
    payload: { text, disable_web_page_preview: true },
  });
};

export type RecordArgs = {
  /** Пространство вызова; пусто — вызов без пространства (ночные задачи): пишем, но слать некому. */
  groupId: string;
  source: KeySource;
  outcome: Outcome;
  now?: Date;
  send?: SendText;
};

/** Записать исход вызова; при настоящем сбое — письмо админам. Бросает только ошибку базы. */
export async function recordOutcome(supabase: SupabaseClient, args: RecordArgs): Promise<void> {
  const { groupId, source, outcome } = args;
  const now = args.now ?? new Date();
  if (outcome.kind === "ignore") return;
  const key = scopeKey(groupId, source);

  if (outcome.kind === "ok" && (healthy.get(key) ?? 0) > now.getTime()) return;

  const { data, error } = await supabase.from(TABLE).select("*").eq("group_id", groupId).eq("source", source)
    .maybeSingle();
  if (error) throw new Error(`ai-health: не прочитать (${error.code ?? "db"})`);
  const prev = (data as HealthRow | null) ?? null;

  if (outcome.kind === "ok") {
    healthy.set(key, now.getTime() + HEALTHY_CACHE_MS);
    if (!prev || (!prev.failing && prev.consecutive_failures === 0)) return;
  } else {
    healthy.delete(key);
  }

  const { row, alertDue } = nextHealth(prev, outcome, now, groupId, source);
  const { error: upErr } = await supabase.from(TABLE).upsert(row, { onConflict: "group_id,source" });
  if (upErr) throw new Error(`ai-health: не записать (${upErr.code ?? "db"})`);
  // Ключ пространства — админам этого пространства (слать некому без пространства); общий ключ — мастерам.
  if (alertDue && (groupId || source === "server")) {
    await alertAdmins(supabase, row, prev, now, args.send ?? defaultSend(supabase));
  }
}

/**
 * Забрать право на письмо (сравнить-и-записать, чтобы два экземпляра не отправили дважды) и разослать.
 * Ключ пространства: кулдаун на строке пространства, адресаты — его админы. Общий ключ: кулдаун
 * один на ВСЕ пространства (общий сбой — одно письмо в сутки), адресаты — мастер-админы.
 */
async function alertAdmins(
  supabase: SupabaseClient,
  row: HealthRow,
  prev: HealthRow | null,
  now: Date,
  send: SendText,
): Promise<void> {
  const isServer = row.source === "server";
  const claimGroup = isServer ? SERVER_ALERT_GROUP : row.group_id;
  let before: string | null;
  if (isServer) {
    // Общая строка кулдауна: заводим пустую, если ещё нет, и читаем актуальную метку.
    await supabase.from(TABLE).upsert(blank(claimGroup, "server"), {
      onConflict: "group_id,source",
      ignoreDuplicates: true,
    });
    const { data } = await supabase.from(TABLE).select("last_alert_at").eq("group_id", claimGroup).eq(
      "source",
      "server",
    )
      .maybeSingle();
    before = (data as { last_alert_at: string | null } | null)?.last_alert_at ?? null;
    if (before && now.getTime() - new Date(before).getTime() < ALERT_COOLDOWN_MS) return;
  } else {
    before = prev?.last_alert_at ?? null;
  }
  let claim = supabase.from(TABLE).update({ last_alert_at: now.toISOString() })
    .eq("group_id", claimGroup).eq("source", row.source);
  claim = before === null ? claim.is("last_alert_at", null) : claim.eq("last_alert_at", before);
  const { data: claimed, error } = await claim.select("group_id");
  if (error || !claimed || claimed.length === 0) return;

  let ids: number[];
  let text: string;
  if (isServer) {
    ids = (await listMasterAdmins(supabase)).map((m) => m.telegram_id);
    text = serverAlertText(row.reason ?? "errors");
  } else {
    const { data: ws } = await supabase.from("workspaces").select("name").eq("id", row.group_id).maybeSingle();
    const name = (ws as { name?: string } | null)?.name ?? row.group_id;
    const { data: admins } = await supabase.from("allowed_users").select("telegram_id")
      .eq("group_id", row.group_id).eq("is_admin", true);
    ids = ((admins ?? []) as Array<{ telegram_id: number | null }>)
      .map((a) => a.telegram_id).filter((id): id is number => typeof id === "number" && id > 0);
    // Языка человека на сервере нет (он живёт в браузере) — русский по умолчанию; EN-текст готов в alertText.
    text = alertText(name, "ru");
  }
  let delivered = 0;
  for (const id of ids) {
    try {
      await send(id, text);
      delivered++;
    } catch (e) {
      console.error(`ai-health: письмо ${id} не ушло:`, e instanceof Error ? e.message : e);
    }
  }
  if (ids.length > 0 && delivered === 0) {
    // Никто не получил — право на письмо возвращаем, следующий сбой попробует снова.
    await supabase.from(TABLE).update({ last_alert_at: before }).eq("group_id", claimGroup).eq("source", row.source);
  }
}

export type KeyIssue = {
  group_id: string;
  source: KeySource;
  reason: FailureReason;
  since: string | null;
  last_failure_at: string | null;
};

/** Идущие сбои ключа: одного пространства или (`undefined`) всех, включая вызовы без пространства. */
export async function keyIssues(supabase: SupabaseClient, groupId: string | undefined): Promise<KeyIssue[]> {
  let q = supabase.from(TABLE).select("*").eq("failing", true);
  if (groupId !== undefined) q = q.eq("group_id", groupId);
  const { data, error } = await q;
  if (error) throw new Error(`ai-health: не прочитать (${error.code ?? "db"})`);
  return ((data ?? []) as HealthRow[]).filter((r) => r.failing && r.reason).map((r) => ({
    group_id: r.group_id,
    source: r.source,
    reason: r.reason!,
    since: r.first_failure_at,
    last_failure_at: r.last_failure_at,
  }));
}

export type StalledGroup = { group_id: string; count: number; oldest_at: string };

/** Встречи в обработке без движения дольше STALL_MINUTES, по пространствам. Названий встреч не отдаёт. */
export async function stalledMeetings(
  supabase: SupabaseClient,
  groupId: string | undefined,
  now: Date = new Date(),
): Promise<StalledGroup[]> {
  let q = supabase.from("meetings").select("group_id, created_at, ended_at, last_progress_at")
    .eq("summary_status", "processing");
  if (groupId !== undefined) q = q.eq("group_id", groupId);
  const { data, error } = await q;
  if (error) throw new Error(`ai-health: встречи (${error.code ?? "db"})`);
  const cutoff = now.getTime() - STALL_MINUTES * 60_000;
  const by = new Map<string, { count: number; oldest: string }>();
  for (
    const m of (data ?? []) as Array<
      { group_id: string | null; created_at: string; ended_at: string | null; last_progress_at: string | null }
    >
  ) {
    if (!m.group_id) continue;
    const last = m.last_progress_at ?? m.ended_at ?? m.created_at;
    if (new Date(last).getTime() > cutoff) continue;
    const cur = by.get(m.group_id);
    by.set(m.group_id, { count: (cur?.count ?? 0) + 1, oldest: cur && cur.oldest < last ? cur.oldest : last });
  }
  return [...by].map(([group_id, v]) => ({ group_id, count: v.count, oldest_at: v.oldest }));
}
