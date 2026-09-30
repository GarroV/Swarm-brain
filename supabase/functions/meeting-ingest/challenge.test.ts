// Перехват права транскрибации решается по измеренной сервером длине выгрузки (T160). Ядро прав:
// здесь решается, чья запись станет стенограммой, которую команда читает как факт.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CHALLENGER_ROLE,
  type ChallengeRow,
  decideChallenge,
  freshChallenge,
  holderHasVersion,
  holderSecondsCorrection,
  settleRecorders,
} from "./challenge.ts";
import { CLAIM_LEASE_TTL_SEC } from "../_shared/meeting-lease.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
const HOLDER = 100;
const TAKER = 200;

function row(over: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    claim_owner: HOLDER,
    recorded_seconds: 600,
    transcript: { segments: [{ end: 590 }] },
    notes_edited_at: null,
    status: "draft",
    lease_expires_at: at(-10),
    agent_last_recording: false,
    // Встреча началась 3 часа назад: потолок по часам сервера здесь не мешает.
    started_at: at(180),
    created_at: at(170),
    ...over,
  };
}

// ── freshChallenge ────────────────────────────────────────────────────────────

Deno.test("заявка-претендент свежая — выгрузка принимается к сверке, сдвиг mic из заявки", () => {
  const recorders = [
    { telegram_id: HOLDER, claimed_at: at(170), role: "transcribe" },
    { telegram_id: TAKER, claimed_at: at(1), role: CHALLENGER_ROLE, mic_start_offset: -1.5 },
  ];
  assertEquals(freshChallenge(recorders, TAKER, NOW), { micStartOffset: -1.5 });
});

Deno.test("претендента нет, он отложен или заявка старше срока лиза — сверки нет", () => {
  assertEquals(freshChallenge([{ telegram_id: TAKER, claimed_at: at(1), role: "defer" }], TAKER, NOW), null);
  assertEquals(freshChallenge([], TAKER, NOW), null);
  assertEquals(freshChallenge(null, TAKER, NOW), null);
  const stale = new Date(Date.parse(NOW) - (CLAIM_LEASE_TTL_SEC + 1) * 1000).toISOString();
  assertEquals(freshChallenge([{ telegram_id: TAKER, claimed_at: stale, role: CHALLENGER_ROLE }], TAKER, NOW), null);
  assertEquals(
    freshChallenge([{ telegram_id: HOLDER, claimed_at: at(1), role: CHALLENGER_ROLE }], TAKER, NOW),
    null,
  );
});

// ── decideChallenge ───────────────────────────────────────────────────────────

Deno.test("#23: измеренная выгрузка заметно полнее записи держателя — перехват по измеренному", () => {
  assertEquals(decideChallenge(row(), 8785, TAKER, NOW), { kind: "takeover", seconds: 8785 });
});

Deno.test("заявка была большой, а измерено немного — отказ, право у держателя", () => {
  assertEquals(decideChallenge(row(), 700, TAKER, NOW).kind, "refuse");
});

Deno.test("не измерено — отказ: без измерения перехвата нет", () => {
  assertEquals(decideChallenge(row(), null, TAKER, NOW).kind, "refuse");
});

Deno.test("измеренное больше, чем встреча могла идти по часам сервера, — урезается потолком", () => {
  // Встреча известна серверу 20 минут: потолок 20·60·1.1+300 = 1620 с < 1.5 × 1200.
  const r = row({ recorded_seconds: 1200, started_at: at(20), created_at: at(20) });
  assertEquals(decideChallenge(r, 80_000, TAKER, NOW).kind, "refuse");
  const ok = row({ recorded_seconds: 300, started_at: at(20), created_at: at(20) });
  assertEquals(decideChallenge(ok, 80_000, TAKER, NOW), { kind: "takeover", seconds: 1620 });
});

Deno.test("правленное человеком и опубликованное не перехватывается даже полной записью", () => {
  assertEquals(decideChallenge(row({ notes_edited_at: at(5) }), 8785, TAKER, NOW).kind, "refuse");
  assertEquals(decideChallenge(row({ status: "in_base" }), 8785, TAKER, NOW).kind, "refuse");
});

Deno.test("бот держателя ещё пишет — отказ (D020), лиз истёк — сверка честная", () => {
  const writing = row({ agent_last_recording: true, lease_expires_at: at(-5) });
  assertEquals(decideChallenge(writing, 8785, TAKER, NOW).kind, "refuse");
  const dead = row({ agent_last_recording: true, lease_expires_at: at(5) });
  assertEquals(decideChallenge(dead, 8785, TAKER, NOW).kind, "takeover");
});

Deno.test("встреча брошена (лиз истёк, стенограммы нет) — занимается и без измерения", () => {
  const free = row({ transcript: null, lease_expires_at: at(1) });
  assertEquals(decideChallenge(free, null, TAKER, NOW), { kind: "occupy", seconds: null });
  const noOwner = row({ transcript: null, claim_owner: null });
  assertEquals(decideChallenge(noOwner, 90, TAKER, NOW), { kind: "occupy", seconds: 90 });
});

Deno.test("запись держателя ещё обрабатывается — встреча не брошена, даже если лиз заявки истёк", () => {
  const busy = row({ transcript: null, lease_expires_at: at(1), summary_status: "processing" });
  assertEquals(decideChallenge(busy, 8785, TAKER, NOW).kind, "takeover");
  assertEquals(decideChallenge(busy, 700, TAKER, NOW).kind, "refuse");
});

Deno.test("у держателя есть своя версия (стенограмма или идущая обработка) — сравнивать есть с чем", () => {
  assertEquals(holderHasVersion(row()), true);
  assertEquals(holderHasVersion(row({ transcript: null, summary_status: "processing" })), true);
  assertEquals(holderHasVersion(row({ transcript: null, summary_status: null })), false);
  assertEquals(holderHasVersion(row({ transcript: null, summary_status: "failed" })), false);
});

// ── settleRecorders ───────────────────────────────────────────────────────────

Deno.test("перехват: претендент — transcribe с измеренными секундами, держатель — superseded", () => {
  const before = [
    { telegram_id: HOLDER, claimed_at: at(170), role: "transcribe", recorded_seconds: 600 },
    { telegram_id: TAKER, claimed_at: at(1), role: CHALLENGER_ROLE, recorded_seconds: 9000 },
  ];
  assertEquals(settleRecorders(before, TAKER, "transcribe", 8785, HOLDER), [
    { telegram_id: HOLDER, claimed_at: at(170), role: "superseded", recorded_seconds: 600 },
    { telegram_id: TAKER, claimed_at: at(1), role: "transcribe", recorded_seconds: 8785 },
  ]);
  assertEquals(before[1].role, CHALLENGER_ROLE, "исходный массив не мутируется");
});

Deno.test("отказ: претендент — defer, секунды заявки остаются, держатель не трогается", () => {
  const before = [
    { telegram_id: HOLDER, claimed_at: at(170), role: "transcribe" },
    { telegram_id: TAKER, claimed_at: at(1), role: CHALLENGER_ROLE, recorded_seconds: 9000 },
  ];
  assertEquals(settleRecorders(before, TAKER, "defer", null, null), [
    { telegram_id: HOLDER, claimed_at: at(170), role: "transcribe" },
    { telegram_id: TAKER, claimed_at: at(1), role: "defer", recorded_seconds: 9000 },
  ]);
});

// ── holderSecondsCorrection ───────────────────────────────────────────────────

const own = { claim_owner: HOLDER, recorded_seconds: 86_000, agent_last_seen_at: null };

Deno.test("первая выгрузка держателя короче его заявки — секунды встречи опускаются до измеренного", () => {
  assertEquals(holderSecondsCorrection(own, HOLDER, null, 3600), 3600);
  assertEquals(holderSecondsCorrection(own, HOLDER, [], 3600), 3600);
});

Deno.test("поправки нет: не держатель, не измерено, заявка не больше, была выгрузка, был бот", () => {
  assertEquals(holderSecondsCorrection(own, TAKER, null, 3600), null);
  assertEquals(holderSecondsCorrection(own, HOLDER, null, null), null);
  assertEquals(holderSecondsCorrection({ ...own, recorded_seconds: 3000 }, HOLDER, null, 3600), null);
  assertEquals(holderSecondsCorrection({ ...own, recorded_seconds: null }, HOLDER, null, 3600), null);
  assertEquals(holderSecondsCorrection(own, HOLDER, ["agent:scriba-1"], 3600), null);
  assertEquals(holderSecondsCorrection({ ...own, agent_last_seen_at: at(3) }, HOLDER, null, 3600), null);
});
