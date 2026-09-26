// Приглашение бота на созвон (решение D017).
//
// Ядро прав доступа: приглашение — единственное, что открывает служебному агенту ручную встречу.
// Ошибка здесь молчалива — приватная запись встаёт на человека, который бота не звал. Поэтому
// каждая граница — отдельным тестом, и каждая проверена порчей.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BOT_PLATFORMS,
  botJoinsPlatform,
  checkInviteForClaim,
  INVITE_TTL_MS,
  type InviteRow,
  inviteStatus,
  MAX_INVITE_LINK_LENGTH,
  parseInviteLink,
  sameRoom,
} from "./meeting-invite.ts";

// ── Разбор ссылки ───────────────────────────────────────────────────────────

Deno.test("ссылки трёх площадок принимаются, площадка определяется по хосту", () => {
  assertEquals(parseInviteLink("https://meet.google.com/abc-defg-hij")?.platform, "meet");
  assertEquals(parseInviteLink("https://ktalk.ru/room42")?.platform, "kontur");
  assertEquals(parseInviteLink("https://team.ktalk.ru/room42")?.platform, "kontur");
  assertEquals(parseInviteLink("https://talk.kontur.ru/room42")?.platform, "kontur");
  assertEquals(parseInviteLink("https://us02web.zoom.us/j/123456789?pwd=abc")?.platform, "zoom");
});

Deno.test("БЛОКИРУЮЩИЙ: бот входит только в Meet — Контур.Толк и Zoom отбиваются при приглашении", () => {
  assertEquals(botJoinsPlatform("meet"), true);
  assertEquals(botJoinsPlatform("kontur"), false);
  assertEquals(botJoinsPlatform("zoom"), false);
  // Площадку добавляют вместе с адаптером бота, а не заодно: список — одна строка.
  assertEquals([...BOT_PLATFORMS], ["meet"]);
});

Deno.test("ссылка приводится к виду без фрагмента и пробелов; запрос (пароль Zoom) сохраняется", () => {
  assertEquals(
    parseInviteLink("  https://meet.google.com/abc-defg-hij#x  ")?.url,
    "https://meet.google.com/abc-defg-hij",
  );
  assertEquals(
    parseInviteLink("https://us02web.zoom.us/j/123?pwd=abc")?.url,
    "https://us02web.zoom.us/j/123?pwd=abc",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: мусор, чужие площадки и подделки хоста не принимаются", () => {
  const bad: unknown[] = [
    undefined,
    null,
    42,
    "",
    "   ",
    "not a link",
    "http://meet.google.com/abc-defg-hij", // не https
    "https://evil.io/abc-defg-hij", // неизвестная площадка
    "https://meet.google.com.evil.io/abc-defg-hij", // подделка хоста суффиксом
    "https://meet.google.com@evil.io/abc-defg-hij", // хост на деле evil.io
    "https://user:pw@meet.google.com/abc-defg-hij", // учётные данные в ссылке
    "https://meet.google.com/", // площадка без комнаты
    "https://meet.google.com",
    `https://meet.google.com/${"a".repeat(MAX_INVITE_LINK_LENGTH)}`, // сверх длины
  ];
  for (const raw of bad) {
    assertEquals(parseInviteLink(raw), null, `принято: ${String(raw).slice(0, 80)}`);
  }
});

Deno.test("одна комната — независимо от hl=en, завершающего слэша и регистра", () => {
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij?hl=en"), true);
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij/", "https://meet.google.com/ABC-defg-hij"), true);
});

Deno.test("БЛОКИРУЮЩИЙ: другая комната, другая площадка, мусор — не одна комната", () => {
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij", "https://meet.google.com/zzz-zzzz-zzz"), false);
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij", "https://ktalk.ru/abc-defg-hij"), false);
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij", "https://evil.io/abc-defg-hij"), false);
  assertEquals(sameRoom("https://meet.google.com/abc-defg-hij", undefined), false);
  assertEquals(sameRoom("garbage", "garbage"), false);
});

// ── Сверка приглашения при заявке агента ────────────────────────────────────

const NOW = Date.parse("2026-09-26T10:00:00Z");
const PERSON = { telegramId: 111, groupId: "ws" };
const LINK = "https://meet.google.com/abc-defg-hij";

const invite: InviteRow = {
  id: "inv-1",
  group_id: "ws",
  invited_by: 111,
  join_url: LINK,
  platform: "meet",
  created_at: new Date(NOW - 60_000).toISOString(),
  expires_at: new Date(NOW - 60_000 + INVITE_TTL_MS).toISOString(),
  taken_at: null,
  used_at: null,
  meeting_id: null,
};

Deno.test("действующее приглашение того же человека на ту же ссылку — проходит", () => {
  assertEquals(checkInviteForClaim(invite, PERSON, LINK, NOW), { ok: true });
  // Бот пинит язык интерфейса (?hl=en) — это та же комната.
  assertEquals(checkInviteForClaim(invite, PERSON, `${LINK}?hl=en`, NOW), { ok: true });
  // Оркестратор уже забрал приглашение в работу — заявка по нему законна.
  assertEquals(checkInviteForClaim({ ...invite, taken_at: invite.created_at }, PERSON, LINK, NOW), { ok: true });
});

Deno.test("БЛОКИРУЮЩИЙ: приглашения нет → отказ", () => {
  assertEquals(checkInviteForClaim(null, PERSON, LINK, NOW), { ok: false, reason: "not_found" });
});

Deno.test("БЛОКИРУЮЩИЙ: приглашение другого человека того же воркспейса → отказ", () => {
  assertEquals(checkInviteForClaim({ ...invite, invited_by: 222 }, PERSON, LINK, NOW), {
    ok: false,
    reason: "other_person",
  });
});

Deno.test("БЛОКИРУЮЩИЙ: приглашение из чужого воркспейса → отказ", () => {
  assertEquals(checkInviteForClaim({ ...invite, group_id: "other" }, PERSON, LINK, NOW), {
    ok: false,
    reason: "other_workspace",
  });
});

Deno.test("БЛОКИРУЮЩИЙ: истёкшее приглашение → отказ (граница срока — уже истекло)", () => {
  const expired = { ...invite, expires_at: new Date(NOW).toISOString() };
  assertEquals(checkInviteForClaim(expired, PERSON, LINK, NOW), { ok: false, reason: "expired" });
});

Deno.test("БЛОКИРУЮЩИЙ: использованное приглашение → отказ", () => {
  const used = { ...invite, used_at: new Date(NOW - 1000).toISOString() };
  assertEquals(checkInviteForClaim(used, PERSON, LINK, NOW), { ok: false, reason: "used" });
});

Deno.test("БЛОКИРУЮЩИЙ: подменённая или отсутствующая ссылка → отказ", () => {
  for (const link of ["https://meet.google.com/zzz-zzzz-zzz", "https://ktalk.ru/abc-defg-hij", undefined, "", 7]) {
    assertEquals(checkInviteForClaim(invite, PERSON, link, NOW), { ok: false, reason: "link_mismatch" });
  }
});

Deno.test("срок приглашения короткий: не больше получаса", () => {
  assertEquals(INVITE_TTL_MS > 0 && INVITE_TTL_MS <= 30 * 60_000, true);
});

// ── Статус для веба ─────────────────────────────────────────────────────────

Deno.test("статус приглашения: ждёт → забрано → использовано; истёкшее — истекло", () => {
  assertEquals(inviteStatus(invite, NOW), "pending");
  assertEquals(inviteStatus({ ...invite, taken_at: invite.created_at }, NOW), "taken");
  assertEquals(inviteStatus({ ...invite, taken_at: invite.created_at, used_at: invite.created_at }, NOW), "used");
  assertEquals(inviteStatus({ ...invite, expires_at: new Date(NOW).toISOString() }, NOW), "expired");
  // Использованное остаётся использованным и после срока: запись встречи уже идёт.
  assertNotEquals(
    inviteStatus({ ...invite, used_at: invite.created_at, expires_at: new Date(NOW - 1).toISOString() }, NOW),
    "expired",
  );
});
