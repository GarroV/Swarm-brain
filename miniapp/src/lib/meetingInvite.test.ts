// deno test --allow-read miniapp/src/lib/meetingInvite.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  inviteErrorText,
  isFinalStatus,
  type MeetingInvite,
  parseInviteErrorCode,
  parseInviteResponse,
} from "./meetingInvite.ts";

const invite = (o: Partial<MeetingInvite> = {}): MeetingInvite => ({
  id: "11111111-1111-4111-8111-111111111111",
  join_url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
  status: "pending",
  created_at: "2026-09-26T10:00:00.000Z",
  expires_at: "2026-09-26T10:15:00.000Z",
  meeting_id: null,
  ...o,
});

Deno.test("ответ сервера { invite } разбирается как есть", () => {
  assertEquals(parseInviteResponse({ invite: invite() }), invite());
  assertEquals(parseInviteResponse({ invite: invite({ status: "used", meeting_id: "m-1" }) })?.meeting_id, "m-1");
});

Deno.test("незнакомый статус не превращается в «ждёт бота»", () => {
  assertEquals(parseInviteResponse({ invite: { ...invite(), status: "knocking" } }), null);
});

Deno.test("битая форма ответа — null, а не приглашение с дырами", () => {
  assertEquals(parseInviteResponse(null), null);
  assertEquals(parseInviteResponse({}), null);
  assertEquals(parseInviteResponse(invite()), null); // без обёртки { invite }
  assertEquals(parseInviteResponse({ invite: { ...invite(), id: "" } }), null);
  assertEquals(parseInviteResponse({ invite: { ...invite(), platform: "teams" } }), null);
  assertEquals(parseInviteResponse({ invite: { ...invite(), meeting_id: 42 } }), null);
});

Deno.test("код ошибки читается из тела, незнакомый — null", () => {
  assertEquals(parseInviteErrorCode({ error: "x", error_ru: "y", code: "too_many_invites" }), "too_many_invites");
  assertEquals(parseInviteErrorCode({ error: "x", code: "boom" }), null);
  assertEquals(parseInviteErrorCode({ error: "no code" }), null);
});

Deno.test("отказ площадки (Zoom) показывается своим текстом, а не общим «не удалось»", () => {
  const body = { error: "x", error_ru: "y", code: "unsupported_platform" };
  assertEquals(parseInviteErrorCode(body), "unsupported_platform");
  const en = inviteErrorText(parseInviteErrorCode(body), (_ru, en) => en);
  const ru = inviteErrorText(parseInviteErrorCode(body), (ru) => ru);
  assertEquals(en, "The bot joins Google Meet and Kontur.Talk calls — Zoom is not supported yet");
  assertEquals(ru, "Бот ходит в Google Meet и Контур.Толк — Zoom пока не поддерживается");
});

Deno.test("опрос идёт, пока бот не записывает и срок не вышел", () => {
  assertEquals(isFinalStatus("pending"), false);
  assertEquals(isFinalStatus("taken"), false);
  assertEquals(isFinalStatus("used"), true);
  assertEquals(isFinalStatus("expired"), true);
});

Deno.test("коллега уже позвал бота в этот звонок — свой текст, а не общее «не удалось»", () => {
  const code = parseInviteErrorCode({ error: "x", code: "already_invited" });
  assertEquals(code, "already_invited");
  const general = inviteErrorText(null, (_ru, en) => en);
  const en = inviteErrorText(code, (_ru, en) => en);
  const ru = inviteErrorText(code, (ru) => ru);
  assertEquals(en === general, false);
  assertEquals(en.includes("colleague"), true);
  assertEquals(ru.includes("коллега"), true);
});
