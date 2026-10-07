// Арбитраж занятой встречи (meeting-claim, ветка «встреча уже кем-то держится»): кто получает право
// транскрибации и какими условиями UPDATE оно защищено от гонки. Ядро: здесь решается, чья запись
// станет стенограммой встречи, которую команда читает как факт.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  botJoinsOverShort,
  botStillRecording,
  claimAction,
  decideHeld,
  deferReasonOf,
  type Guard,
  heldGuards,
  type HeldRow,
  readClaimSeconds,
  shortClipGuards,
} from "./arbiter.ts";
import { MAX_RECORDED_SECONDS } from "../_shared/meeting-lease.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const BOT_OWNER = 111; // за него бот пишет встречу
const OTHER = 222; // другой участник со своим рекордером

/** Встреча, которую бот пишет прямо сейчас: лиз продлён последним ударом, флаг записи взведён. */
function liveBotRow(recordedSeconds = 600): HeldRow {
  return {
    claim_owner: BOT_OWNER,
    recorded_seconds: recordedSeconds,
    transcript: null,
    notes_edited_at: null,
    status: null,
    lease_expires_at: "2026-09-28T12:28:00.000Z",
    agent_last_recording: true,
  };
}

// ── Бот ещё пишет ──────────────────────────────────────────────────────────────

Deno.test("ЯДРО: бот ещё пишет — это лиз действует И флаг записи взведён", () => {
  assertEquals(botStillRecording(liveBotRow(), NOW), true);
  assertEquals(botStillRecording({ ...liveBotRow(), agent_last_recording: false }, NOW), false, "бот остановил запись");
  assertEquals(botStillRecording({ ...liveBotRow(), agent_last_recording: null }, NOW), false, "бота не было");
  assertEquals(
    botStillRecording({ ...liveBotRow(), lease_expires_at: "2026-09-28T11:59:59.000Z" }, NOW),
    false,
    "лиз истёк — бот умер: флаг остался взведённым, но ударов нет",
  );
  assertEquals(botStillRecording({ ...liveBotRow(), lease_expires_at: null }, NOW), false);
});

Deno.test("ЯДРО D020: запись рекордера ДРУГОГО человека не перехватывает встречу у пишущего бота, даже заметно более полная", () => {
  // Рекордер, начавший раньше и остановившийся на 20-й минуте, отобрал бы встречу у бота с 10
  // минутами, который допишет её до 60-й: бот получил бы 403 и ушёл со звонка.
  assertEquals(decideHeld(liveBotRow(600), 1200, OTHER, NOW), "defer");
  assertEquals(decideHeld(liveBotRow(0), 7200, OTHER, NOW), "defer");
});

Deno.test("ЯДРО D020: запись рекордера ТОГО ЖЕ человека при пишущем боте — запасная: выгружается, встреча не перехватывается", () => {
  // Отказ выбросил бы её в карантин клиента, и умри бот — в базе не осталось бы ничего. Запасная
  // обрабатывается сразу, а бот, дописав, сравнивается с ней по объёму распознанного (meeting-ingest).
  assertEquals(decideHeld(liveBotRow(600), 1200, BOT_OWNER, NOW), "reserve");
  // Даже короче того, что бот записал к этой минуте: бот ещё может умереть.
  assertEquals(decideHeld(liveBotRow(3000), 400, BOT_OWNER, NOW), "reserve");
});

Deno.test("правленную человеком или опубликованную встречу не трогает никто, и запасной тоже нет", () => {
  assertEquals(decideHeld({ ...liveBotRow(), notes_edited_at: NOW }, 1200, BOT_OWNER, NOW), "defer");
  assertEquals(decideHeld({ ...liveBotRow(), status: "in_base" }, 1200, BOT_OWNER, NOW), "defer");
  const idle = { ...liveBotRow(60), agent_last_recording: false };
  assertEquals(decideHeld({ ...idle, status: "in_base" }, 7200, OTHER, NOW), "defer");
});

// ── Бот не пишет (остановился или умер) — прежний арбитраж по полноте ──────────

Deno.test("ЯДРО: бот умер (лиз истёк) — заметно более полная запись другого человека перехватывает, как раньше", () => {
  const dead = { ...liveBotRow(600), lease_expires_at: "2026-09-28T11:00:00.000Z" };
  assertEquals(decideHeld(dead, 1200, OTHER, NOW), "takeover");
  assertEquals(decideHeld(dead, 700, OTHER, NOW), "defer", "не заметно полнее — отказ");
});

Deno.test("ЯДРО: тот же человек и заметно более полная запись при остановившемся боте — право без сброса маркеров обработки", () => {
  // Сброс маркеров посреди работы воркера стоил повторной транскрибации (сдача T156): claim_owner
  // не меняется, вторую запись того же владельца meeting-ingest сравнивает сам.
  const idle = { ...liveBotRow(600), agent_last_recording: false };
  assertEquals(decideHeld(idle, 1200, BOT_OWNER, NOW), "refresh");
  assertEquals(decideHeld(idle, 700, BOT_OWNER, NOW), "defer");
});

Deno.test("запись без секунд (старая сборка) никогда не перехватывает", () => {
  const idle = { ...liveBotRow(0), agent_last_recording: false };
  assertEquals(decideHeld(idle, 0, OTHER, NOW), "defer");
});

Deno.test("держатель без recorded_seconds оценивается по концу последнего сегмента стенограммы", () => {
  const legacy: HeldRow = {
    ...liveBotRow(0),
    agent_last_recording: null,
    recorded_seconds: null,
    transcript: { segments: [{ end: 100 }, { end: 1000 }] },
  };
  assertEquals(decideHeld(legacy, 1400, OTHER, NOW), "defer", "1400 < 1000 × 1.5");
  assertEquals(decideHeld(legacy, 1500, OTHER, NOW), "takeover");
});

// ── Условия UPDATE: решение, принятое по прочитанной строке, не должно лечь на изменившуюся ────

/** Проверка условий на строке в памяти — та же семантика, что у фильтров PostgREST. */
function passes(held: HeldRow, guards: Guard[]): boolean {
  const row: Record<string, unknown> = { ...held };
  const holds = (g: Guard): boolean => {
    switch (g.kind) {
      case "eq":
        return row[g.column] === g.value;
      case "isNull":
        return row[g.column] === null;
      case "notNull":
        return row[g.column] !== null && row[g.column] !== undefined;
      case "neq":
        return row[g.column] !== g.value;
      case "notTrue":
        return row[g.column] !== true;
      case "before": {
        const v = row[g.column];
        return typeof v === "string" && Date.parse(v) < Date.parse(g.value);
      }
      case "anyOf":
        return g.clauses.some(holds);
    }
  };
  return guards.every(holds);
}

Deno.test("ЯДРО (TOCTOU): перехват сверяет в UPDATE, что секунды держателя не выросли, пока claim считал", () => {
  // Разбор прав T155 (MEDIUM): claim прочитал 600 с, решил «1200 заметно полнее», а удар бота тем
  // временем записал 1500 — без сверки перехват лёг бы на запись, которая уже не короче.
  const read = { ...liveBotRow(600), agent_last_recording: false };
  const guards = heldGuards(read, NOW);
  assertEquals(passes(read, guards), true, "строка не менялась — UPDATE проходит");
  assertEquals(passes({ ...read, recorded_seconds: 1500 }, guards), false);
  assertEquals(passes({ ...read, claim_owner: OTHER }, guards), false, "право уже перехватили");
  const unset = { ...read, recorded_seconds: null };
  assertEquals(passes(unset, heldGuards(unset, NOW)), true);
  assertEquals(passes({ ...unset, recorded_seconds: 30 }, heldGuards(unset, NOW)), false);
});

Deno.test("ЯДРО (TOCTOU): перехват сверяет в UPDATE, что бот не начал писать, пока claim считал", () => {
  const read = { ...liveBotRow(600), agent_last_recording: false };
  const guards = heldGuards(read, NOW);
  assertEquals(passes({ ...read, agent_last_recording: true }, guards), false, "удар recording:true успел");
  assertEquals(
    passes({ ...read, agent_last_recording: true, lease_expires_at: "2026-09-28T11:00:00.000Z" }, guards),
    true,
    "флаг взведён, но лиз истёк — бот мёртв",
  );
  assertEquals(passes({ ...read, agent_last_recording: null }, guards), true);
});

Deno.test("ЯДРО (TOCTOU): перехват не ложится на встречу, опубликованную или правленную после чтения", () => {
  const read = { ...liveBotRow(600), agent_last_recording: false, status: "awaiting_review" };
  const guards = heldGuards(read, NOW);
  assertEquals(passes(read, guards), true);
  assertEquals(passes({ ...read, status: "in_base" }, guards), false, "опубликовали, пока считали");
  assertEquals(passes({ ...read, notes_edited_at: "2026-09-28T11:59:00.000Z" }, guards), false, "правили");
});

Deno.test("ЯДРО: секунды сверх суток в claim — отказ, как в heartbeat (разбор прав T155, LOW)", () => {
  // Завышенное значение навсегда закрыло бы встречу от перехвата более полной записью.
  assertThrows(() => readClaimSeconds(MAX_RECORDED_SECONDS + 1), Error, "recorded_seconds");
  assertThrows(() => readClaimSeconds(1e12), Error, "recorded_seconds");
  assertEquals(readClaimSeconds(MAX_RECORDED_SECONDS), MAX_RECORDED_SECONDS);
  // Прежнее поведение для мусора и нуля: секунд нет, перехват не запрашивается.
  for (const soft of [undefined, null, "600", Number.NaN, -5, 0]) assertEquals(readClaimSeconds(soft), undefined);
  assertEquals(readClaimSeconds(1260.5), 1260.5);
});

Deno.test("ЯДРО T160: заявка другого человека в claim не перехватывает — только претендент до измеренной выгрузки", () => {
  assertEquals(claimAction("takeover"), "challenge");
  assertEquals(claimAction("defer"), "defer");
  assertEquals(claimAction("reserve"), "reserve");
  assertEquals(claimAction("refresh"), "refresh");
});

// ── Причина отказа (issue #274 из main, сведено со стройкой 28.09.2026) ─────────────────────

Deno.test("deferReasonOf: причина отказа совпадает с веткой decideHeld, которая дала defer", () => {
  const stopped: HeldRow = { ...liveBotRow(3000), agent_last_recording: false };
  // Опубликованную/правленную не перехватить никогда — даже при пишущем боте причина «published».
  assertEquals(deferReasonOf({ ...liveBotRow(600), status: "in_base" }, 7200, NOW), "published");
  assertEquals(deferReasonOf({ ...stopped, notes_edited_at: NOW }, 7200, NOW), "published");
  // Бот другого человека ещё пишет — отказ из-за D020, а не из-за длины.
  assertEquals(decideHeld(liveBotRow(600), 7200, OTHER, NOW), "defer");
  assertEquals(deferReasonOf(liveBotRow(600), 7200, NOW), "recording");
  // Бот остановился: короче, почти так же, неизвестно.
  assertEquals(deferReasonOf(stopped, 1200, NOW), "shorter");
  assertEquals(deferReasonOf(stopped, 3100, NOW), "similar");
  assertEquals(deferReasonOf(stopped, 0, NOW), "unknown");
  assertEquals(deferReasonOf({ ...stopped, recorded_seconds: null }, 1200, NOW), "unknown");
});

// ── Бот поверх короткой записи (07.10.2026) ───────────────────────────────────

/** Рекордер человека уже выгрузил первые две минуты встречи; обработка кончилась, лиз ещё жив. */
function shortClipRow(seconds = 120): HeldRow {
  return {
    claim_owner: OTHER,
    recorded_seconds: seconds,
    transcript: { segments: [{ end: seconds }] },
    notes_edited_at: null,
    status: null,
    lease_expires_at: "2026-09-28T12:20:00.000Z",
    agent_last_recording: null,
    summary_status: "done",
  };
}

Deno.test("ЯДРО: короткая готовая запись рекордера не отменяет бота — он идёт писать встречу", () => {
  assertEquals(decideHeld(shortClipRow(), 0, BOT_OWNER, NOW), "defer", "старое правило отказывало бы");
  assertEquals(botJoinsOverShort(shortClipRow(), true, 0, NOW), true);
  assertEquals(
    botJoinsOverShort({ ...shortClipRow(), claim_owner: BOT_OWNER }, true, 0, NOW),
    true,
    "запись того же человека — тоже",
  );
});

Deno.test("ЯДРО: бот поверх записи — только когда всё сразу", () => {
  assertEquals(botJoinsOverShort(shortClipRow(), false, 0, NOW), false, "рекордер, а не бот");
  assertEquals(botJoinsOverShort(shortClipRow(), true, 60, NOW), false, "бот уже с секундами — обычное правило");
  assertEquals(botJoinsOverShort(shortClipRow(300), true, 0, NOW), false, "запись от 5 минут — бот не идёт");
  assertEquals(botJoinsOverShort({ ...shortClipRow(), transcript: null }, true, 0, NOW), false, "выгрузка ещё идёт");
  assertEquals(
    botJoinsOverShort({ ...shortClipRow(), summary_status: "processing" }, true, 0, NOW),
    false,
    "обработка идёт",
  );
  assertEquals(botJoinsOverShort({ ...shortClipRow(), notes_edited_at: NOW }, true, 0, NOW), false, "правили руками");
  assertEquals(botJoinsOverShort({ ...shortClipRow(), status: "in_base" }, true, 0, NOW), false, "опубликовано");
  assertEquals(botJoinsOverShort(liveBotRow(60), true, 0, NOW), false, "встречу уже пишет бот");
});

Deno.test("ЯДРО (TOCTOU): бот поверх записи не ложится на строку, изменившуюся после чтения", () => {
  const held = shortClipRow();
  const guards = shortClipGuards(held, NOW);
  assertEquals(passes(held, guards), true);
  assertEquals(passes({ ...held, recorded_seconds: 900 }, guards), false, "секунды выросли");
  assertEquals(passes({ ...held, summary_status: "processing" }, guards), false, "пошла обработка");
  assertEquals(passes({ ...held, summary_status: null }, guards), true, "маркер пуст — можно");
  assertEquals(passes({ ...held, transcript: null }, guards), false, "стенограммы нет");
  assertEquals(passes({ ...held, claim_owner: 333 }, guards), false, "держатель сменился");
  assertEquals(passes({ ...held, status: "in_base" }, guards), false, "опубликовали");
});
