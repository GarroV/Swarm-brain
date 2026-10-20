import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeFakeDb } from "./workspace-keys.fake.ts";
import {
  ALERT_COOLDOWN_MS,
  alertText,
  classifyResponse,
  type HealthRow,
  keyIssues,
  nextHealth,
  recordOutcome,
  resetHealthCache,
  serverAlertText,
  SOFT_MIN_FAILURES,
  SOFT_MIN_SPAN_MS,
} from "./ai-health.ts";

const T0 = new Date("2026-10-19T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

Deno.test("classifyResponse: 401 и нет денег — сразу; 5xx и 429 без кода квоты — мягкий сбой; 400 — не сбой ключа", () => {
  assertEquals(classifyResponse(200), { kind: "ok" });
  assertEquals(classifyResponse(401), { kind: "hard", reason: "rejected" });
  assertEquals(classifyResponse(429, "insufficient_quota"), { kind: "hard", reason: "quota" });
  assertEquals(classifyResponse(429, "billing_hard_limit_reached"), { kind: "hard", reason: "quota" });
  assertEquals(classifyResponse(429, "rate_limit_exceeded"), { kind: "soft" });
  assertEquals(classifyResponse(429), { kind: "soft" });
  assertEquals(classifyResponse(500), { kind: "soft" });
  assertEquals(classifyResponse(503), { kind: "soft" });
  assertEquals(classifyResponse(400), { kind: "ignore" });
  assertEquals(classifyResponse(404), { kind: "ignore" });
});

Deno.test("nextHealth: жёсткий сбой — сразу failing и пора слать", () => {
  const r = nextHealth(null, { kind: "hard", reason: "rejected" }, T0);
  assertEquals(r.row.failing, true);
  assertEquals(r.row.reason, "rejected");
  assertEquals(r.alertDue, true);
});

Deno.test("nextHealth: единичный и короткий мягкий сбой не поднимает тревогу", () => {
  let row: HealthRow | null = null;
  for (let i = 0; i < SOFT_MIN_FAILURES - 1; i++) {
    const r = nextHealth(row, { kind: "soft" }, at(i * 6 * MIN));
    row = r.row;
    assertEquals(r.row.failing, false);
    assertEquals(r.alertDue, false);
  }
});

Deno.test("nextHealth: два сбоя с большим разрывом — число не набрано, не тревога", () => {
  let row: HealthRow | null = null;
  row = nextHealth(row, { kind: "soft" }, at(0)).row;
  const r = nextHealth(row, { kind: "soft" }, at(SOFT_MIN_SPAN_MS * 2));
  assertEquals(r.row.failing, false);
  assertEquals(r.alertDue, false);
});

Deno.test("nextHealth: много сбоев подряд, но быстрее порога по времени — не тревога", () => {
  let row: HealthRow | null = null;
  for (let i = 0; i < SOFT_MIN_FAILURES + 5; i++) row = nextHealth(row, { kind: "soft" }, at(i * 1000)).row;
  assertEquals(row!.failing, false);
});

Deno.test("nextHealth: мягкие сбои держатся порог по числу И по времени — тревога", () => {
  let row: HealthRow | null = null;
  for (let i = 0; i < SOFT_MIN_FAILURES; i++) row = nextHealth(row, { kind: "soft" }, at(0)).row;
  assertEquals(row!.failing, false, "число набрано, времени ещё нет");
  const r = nextHealth(row, { kind: "soft" }, at(SOFT_MIN_SPAN_MS));
  assertEquals(r.row.failing, true);
  assertEquals(r.row.reason, "errors");
  assertEquals(r.alertDue, true);
});

Deno.test("nextHealth: успех в промежутке обнуляет счёт мягких сбоев", () => {
  let row: HealthRow | null = null;
  for (let i = 0; i < SOFT_MIN_FAILURES - 1; i++) row = nextHealth(row, { kind: "soft" }, at(i * 6 * MIN)).row;
  row = nextHealth(row, { kind: "ok" }, at(20 * MIN)).row;
  assertEquals(row!.consecutive_failures, 0);
  const r = nextHealth(row, { kind: "soft" }, at(30 * MIN));
  assertEquals(r.row.failing, false);
});

Deno.test("nextHealth: успех гасит тревогу, но метку последнего письма сохраняет", () => {
  const first = nextHealth(null, { kind: "hard", reason: "quota" }, T0);
  const sent = { ...first.row, last_alert_at: T0.toISOString() };
  const ok = nextHealth(sent, { kind: "ok" }, at(5 * MIN)).row;
  assertEquals(ok.failing, false);
  assertEquals(ok.reason, null);
  assertEquals(ok.last_alert_at, T0.toISOString());
});

Deno.test("nextHealth: письмо не чаще раза в сутки на пространство, даже после «починили — сломали снова»", () => {
  const sent: HealthRow = {
    ...nextHealth(null, { kind: "hard", reason: "rejected" }, T0).row,
    last_alert_at: T0.toISOString(),
  };
  const healed = nextHealth(sent, { kind: "ok" }, at(MIN)).row;
  assertEquals(nextHealth(healed, { kind: "hard", reason: "rejected" }, at(2 * MIN)).alertDue, false);
  assertEquals(nextHealth(healed, { kind: "hard", reason: "rejected" }, at(ALERT_COOLDOWN_MS + MIN)).alertDue, true);
});

Deno.test("alertText: точный текст владельца, RU и EN", () => {
  assertEquals(
    alertText("IMF BD", "ru"),
    "Ключ нейросети в пространстве «IMF BD» перестал работать. Обновите его: Настройки → Пространство.",
  );
  assertEquals(
    alertText("IMF BD", "en"),
    "The AI key for workspace «IMF BD» has stopped working. Update it: Settings → Workspace.",
  );
});

const sent: Array<{ to: number; text: string }> = [];
const send = (to: number, text: string) => {
  sent.push({ to, text });
  return Promise.resolve();
};

function setup() {
  resetHealthCache();
  sent.length = 0;
  return makeFakeDb({
    workspaces: [{ id: "cee", name: "IMF BD" }, { id: "demo", name: "Demo" }],
    master_admins: [{ telegram_id: 900 }],
    allowed_users: [
      { telegram_id: 1, group_id: "cee", is_admin: true },
      { telegram_id: 2, group_id: "cee", is_admin: false },
      { telegram_id: 3, group_id: "cee", is_admin: true },
      { telegram_id: 4, group_id: "demo", is_admin: true },
    ],
  });
}

Deno.test("recordOutcome: 401 → админам ЭТОГО пространства, не участникам и не чужим админам; один раз в сутки", async () => {
  const db = setup();
  const args = {
    groupId: "cee",
    source: "workspace" as const,
    outcome: { kind: "hard", reason: "rejected" } as const,
    send,
  };
  await recordOutcome(db.client, { ...args, now: T0 });
  assertEquals(sent.map((s) => s.to).sort(), [1, 3]);
  assert(sent.every((s) => s.text.includes("«IMF BD»")));
  await recordOutcome(db.client, { ...args, now: at(5 * MIN) });
  await recordOutcome(db.client, { ...args, now: at(ALERT_COOLDOWN_MS - MIN) });
  assertEquals(sent.length, 2, "в пределах суток повторов нет");
  await recordOutcome(db.client, { ...args, now: at(ALERT_COOLDOWN_MS + MIN) });
  assertEquals(sent.length, 4, "через сутки — снова");
});

const MASTERS = [744230399, 900];
const quota = { kind: "hard", reason: "quota" } as const;

Deno.test("общий ключ сервера: письмо ТОЛЬКО мастер-админам, админам пространств — нет; текст с причиной", async () => {
  const db = setup();
  await recordOutcome(db.client, { groupId: "demo", source: "server", outcome: quota, send, now: T0 });
  assertEquals(sent.map((s) => s.to).sort(), MASTERS.slice().sort());
  assert(!sent.some((s) => [1, 2, 3, 4].includes(s.to)), "админы пространств не получают");
  assertEquals(
    sent[0].text,
    "Общий ключ нейросети перестал работать (закончились деньги или квота). Пространства без своего ключа сейчас без обработки.",
  );
  for (const [reason, label] of [["rejected", "ключ отклонён"], ["errors", "ошибки не проходят"]] as const) {
    assertEquals(
      serverAlertText(reason),
      `Общий ключ нейросети перестал работать (${label}). Пространства без своего ключа сейчас без обработки.`,
    );
  }
});

Deno.test("общий ключ сервера: сбой в нескольких пространствах — одно письмо мастерам в сутки; вызов без пространства тоже будит мастера", async () => {
  const db = setup();
  await recordOutcome(db.client, { groupId: "cee", source: "server", outcome: quota, send, now: T0 });
  await recordOutcome(db.client, { groupId: "demo", source: "server", outcome: quota, send, now: at(MIN) });
  await recordOutcome(db.client, { groupId: "", source: "server", outcome: quota, send, now: at(2 * MIN) });
  assertEquals(sent.length, MASTERS.length, "общий кулдаун на все пространства");
  await recordOutcome(db.client, {
    groupId: "cee",
    source: "server",
    outcome: quota,
    send,
    now: at(ALERT_COOLDOWN_MS + MIN),
  });
  assertEquals(sent.length, MASTERS.length * 2, "через сутки — снова");
  assertEquals(db.tables.ai_key_health.filter((r) => r.source === "server").length, 3);
});

Deno.test("общий ключ сервера: мастерам не дошло — право на письмо возвращается", async () => {
  const db = setup();
  const failing = () => Promise.reject(new Error("telegram down"));
  await recordOutcome(db.client, { groupId: "cee", source: "server", outcome: quota, send: failing, now: T0 });
  await recordOutcome(db.client, { groupId: "cee", source: "server", outcome: quota, send, now: at(MIN) });
  assertEquals(sent.length, MASTERS.length);
});

Deno.test("свой ключ пространства: письмо админам этого пространства, мастерам — нет", async () => {
  const db = setup();
  await recordOutcome(db.client, { groupId: "demo", source: "workspace", outcome: quota, send, now: T0 });
  assertEquals(sent.map((s) => s.to), [4]);
  assert(sent[0].text.startsWith("Ключ нейросети в пространстве «Demo»"));
});

Deno.test("recordOutcome: мягкие сбои тревожат только если держатся; успех гасит", async () => {
  const db = setup();
  const soft = { groupId: "cee", source: "workspace" as const, outcome: { kind: "soft" } as const, send };
  for (let i = 0; i < SOFT_MIN_FAILURES; i++) await recordOutcome(db.client, { ...soft, now: at(i * MIN) });
  assertEquals(sent.length, 0);
  assertEquals((await keyIssues(db.client, "cee")).length, 0);
  await recordOutcome(db.client, { ...soft, now: at(SOFT_MIN_SPAN_MS + MIN) });
  assertEquals(sent.length, 2);
  assertEquals((await keyIssues(db.client, "cee")).map((i) => i.reason), ["errors"]);
  await recordOutcome(db.client, {
    groupId: "cee",
    source: "workspace",
    outcome: { kind: "ok" },
    send,
    now: at(30 * MIN),
  });
  assertEquals((await keyIssues(db.client, "cee")).length, 0, "после успешного вызова баннера нет");
});

Deno.test("recordOutcome: Telegram не принял никого — метка письма откатывается, следующий сбой пробует снова", async () => {
  const db = setup();
  const failing = () => Promise.reject(new Error("telegram down"));
  const base = { groupId: "cee", source: "workspace" as const, outcome: { kind: "hard", reason: "rejected" } as const };
  await recordOutcome(db.client, { ...base, send: failing, now: T0 });
  await recordOutcome(db.client, { ...base, send, now: at(MIN) });
  assertEquals(sent.length, 2);
});

Deno.test("keyIssues: пространство видит только свои сбои; undefined — все (мастер), включая вызовы без пространства", async () => {
  const db = setup();
  const hard = { kind: "hard", reason: "quota" } as const;
  await recordOutcome(db.client, { groupId: "cee", source: "server", outcome: hard, send, now: T0 });
  await recordOutcome(db.client, { groupId: "demo", source: "server", outcome: hard, send, now: T0 });
  await recordOutcome(db.client, { groupId: "", source: "server", outcome: hard, send, now: T0 });
  assertEquals((await keyIssues(db.client, "cee")).map((i) => i.group_id), ["cee"]);
  assertEquals((await keyIssues(db.client, undefined)).map((i) => i.group_id).sort(), ["", "cee", "demo"]);
});

Deno.test("recordOutcome: ok на здоровом ключе не ходит в базу чаще раза в минуту", async () => {
  const db = setup();
  const ok = { groupId: "cee", source: "workspace" as const, outcome: { kind: "ok" } as const, send };
  await recordOutcome(db.client, { ...ok, now: T0 });
  await recordOutcome(db.client, { ...ok, now: at(10_000) });
  await recordOutcome(db.client, { ...ok, now: at(20_000) });
  assert((db.reads.ai_key_health ?? 0) <= 1, "одно чтение на первый вызов, дальше кэш");
});
