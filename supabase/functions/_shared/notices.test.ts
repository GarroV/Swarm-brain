// Блок notices. Здесь проверяется то, за что блок отвечает целиком: молчаливых отказов не бывает,
// а поток уведомлений человеку конечен.
//
// Блокирующие по смыслу, а не по стилю:
//   • «потолок считает сервер» — решение принимается ТОЛЬКО по журналу отправок. Пока номер
//     попытки брался из тела запроса, потолка не было вовсе: зацикленный контейнер шлёт
//     «попытка 1» сколько угодно раз, и человек получает поток сообщений в личку.
//   • «у каждого отказа есть текст на обоих языках» — структурный. Добавить kind и забыть текст
//     легко, и наружу это выходит пустым сообщением в Telegram, то есть тем самым молчаливым
//     отказом, ради которого блок и заведён.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideDelivery,
  DOOR_MAX_ATTEMPTS,
  DOOR_REPEAT_SECONDS,
  DOOR_WAIT_SECONDS,
  isPreMeetingKind,
  MAX_DETAIL_CHARS,
  MAX_PER_KIND,
  MAX_PER_MEETING,
  MAX_PER_RECIPIENT_PER_DAY,
  MAX_TITLE_CHARS,
  MAX_UNBOUND_PER_RECIPIENT_PER_DAY,
  NOTICE_KINDS,
  NOTICE_LANGS,
  NoticeError,
  type NoticeLedger,
  parseNotice,
  PRE_MEETING_KINDS,
  renderNotice,
} from "./notices.ts";
import { NO_TITLE, NOTICE_TEXTS } from "./notice-texts.ts";

const MEETING_ID = "5f0c6b1e-8a2d-4c3f-9b7e-1d2a3c4b5e6f";
const KEY = "abc123@google.com:2026-09-23";

/** Тело запроса нужной формы: у встречных видов — meeting_id, у до-встречных — ключ календаря. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  const kind = (over.kind ?? "door_waiting") as string;
  const base = (PRE_MEETING_KINDS as readonly string[]).includes(kind)
    ? { kind, meeting_key: KEY, title: "Weekly sync" }
    : { kind, meeting_id: MEETING_ID };
  return { ...base, ...over };
}

function notice(over: Record<string, unknown> = {}) {
  return parseNotice(body(over));
}

/** Пустой журнал плюс то, что нужно тесту. */
function ledger(over: Partial<NoticeLedger> = {}): NoticeLedger {
  return { kindCount: 0, totalCount: 0, dayCount: 0, unboundDayCount: 0, ...over };
}

// ── Дверь: первое уведомление, ровно один повтор, выход ───────────────────────

Deno.test("дверь: журнал пуст — первое уведомление, повтор обещан через 3 минуты", () => {
  assertEquals(decideDelivery(notice(), ledger()), {
    allow: true,
    attempt: 1,
    shouldLeave: false,
    nextReminderInSeconds: DOOR_REPEAT_SECONDS,
  });
});

Deno.test("дверь: одно уже ушло — это повтор, и он последний", () => {
  assertEquals(decideDelivery(notice(), ledger({ kindCount: 1, totalCount: 1, dayCount: 1 })), {
    allow: true,
    attempt: 2,
    shouldLeave: true,
    nextReminderInSeconds: null,
  });
});

Deno.test("БЛОКИРУЮЩИЙ: два уже ушло — третьего не будет, счёт по журналу", () => {
  const decision = decideDelivery(notice(), ledger({ kindCount: 2, totalCount: 2, dayCount: 2 }));
  assertEquals(decision.allow, false);
  assert(decision.allow === false);
  assertEquals(decision.shouldLeave, true, "боту не сказали уйти — он останется висеть у двери");
  assert(
    /one reminder|limit/i.test(decision.reason),
    `отказ должен объяснять, что повтор ровно один: ${decision.reason}`,
  );
});

Deno.test("БЛОКИРУЮЩИЙ: номер попытки из тела запроса не принимается вовсе", () => {
  // Пока он принимался, «потолок» держался на добросовестности бота: пришли `attempt: 1`
  // трижды — и человек получил три сообщения, а сервер отчитался, что всё в порядке.
  for (const attempt of [1, 2, 99]) {
    const e = assertThrows(() => notice({ attempt }), NoticeError, undefined, `attempt=${attempt}`);
    assertEquals(e.status, 400);
    assert(e.message.includes("server"), `в отказе должно быть сказано, что попытку считает сервер: ${e.message}`);
  }
});

Deno.test("дверь: расписание — 90 секунд до сигнала, 180 до повтора, всего две попытки", () => {
  assertEquals(DOOR_WAIT_SECONDS, 90);
  assertEquals(DOOR_REPEAT_SECONDS, 180);
  assertEquals(DOOR_MAX_ATTEMPTS, 2);
});

// ── Поток конечен для КАЖДОГО вида, по встрече и по человеку ──────────────────

Deno.test("БЛОКИРУЮЩИЙ: один и тот же отказ не повторяется — «звука нет» уже сказано", () => {
  const audio = notice({ kind: "no_audio" });
  assertEquals(decideDelivery(audio, ledger({ totalCount: 1, dayCount: 1 })).allow, true);
  const again = decideDelivery(audio, ledger({ kindCount: MAX_PER_KIND, totalCount: 2, dayCount: 2 }));
  assertEquals(again.allow, false);
  assert(again.allow === false);
  assert(again.reason.includes("no_audio"), again.reason);
  assertEquals(again.shouldLeave, true);
});

Deno.test("БЛОКИРУЮЩИЙ: общий потолок на встречу — дальше не шлём ничего, даже нового вида", () => {
  for (const kind of NOTICE_KINDS) {
    const decision = decideDelivery(
      notice({ kind, detail: "x" }),
      ledger({ totalCount: MAX_PER_MEETING, dayCount: MAX_PER_MEETING }),
    );
    assertEquals(decision.allow, false, `${kind}: поток по встрече не ограничен`);
    assert(decision.allow === false);
    assertEquals(decision.shouldLeave, true);
  }
});

Deno.test("БЛОКИРУЮЩИЙ: суточный потолок на человека — новая встреча не открывает новый поток", () => {
  // Зацикленный оркестратор заводит встречу за встречей: поштучный счёт каждой пуст, и только
  // счёт по человеку за сутки не даёт превратить личку в ленту.
  for (const kind of NOTICE_KINDS) {
    const decision = decideDelivery(notice({ kind, detail: "x" }), ledger({ dayCount: MAX_PER_RECIPIENT_PER_DAY }));
    assertEquals(decision.allow, false, `${kind}: сутки без потолка`);
    assert(decision.allow === false);
    assert(/day|24/i.test(decision.reason), decision.reason);
  }
});

Deno.test("БЛОКИРУЮЩИЙ: до-встречные отказы — свой суточный потолок, ключ календаря сервер не проверит", () => {
  for (const kind of PRE_MEETING_KINDS) {
    const decision = decideDelivery(
      notice({ kind, meeting_key: `fresh-${kind}` }),
      ledger({ unboundDayCount: MAX_UNBOUND_PER_RECIPIENT_PER_DAY, dayCount: MAX_UNBOUND_PER_RECIPIENT_PER_DAY }),
    );
    assertEquals(decision.allow, false, `${kind}: выдуманные ключи дают бесконечный поток`);
  }
  // Встречным видам этот счёт не мешает: их встреча проверена сервером.
  const bound = decideDelivery(notice({ kind: "no_audio" }), ledger({ unboundDayCount: 99, dayCount: 1 }));
  assertEquals(bound.allow, true);
  assert(MAX_UNBOUND_PER_RECIPIENT_PER_DAY < MAX_PER_RECIPIENT_PER_DAY);
});

Deno.test("терминальные отказы велят уйти сразу и повтора не обещают", () => {
  for (const kind of NOTICE_KINDS.filter((k) => k !== "door_waiting")) {
    const decision = decideDelivery(notice({ kind, detail: "x" }), ledger());
    assert(decision.allow === true);
    assertEquals(decision.shouldLeave, true, `${kind}: боту не сказано уйти`);
    assertEquals(decision.nextReminderInSeconds, null, `${kind}: обещан повтор, которого не будет`);
  }
});

// ── Разбор запроса: встреча названа, мусор отвергается внятно ─────────────────

Deno.test("БЛОКИРУЮЩИЙ: встречный отказ без meeting_id не принимается — сверять было бы не с чем", () => {
  for (const kind of NOTICE_KINDS.filter((k) => !isPreMeetingKind(k))) {
    for (const bad of [undefined, null, "", "not-a-uuid", 42, KEY]) {
      const e = assertThrows(
        () => parseNotice({ kind, meeting_id: bad, detail: "x" }),
        NoticeError,
        undefined,
        `${kind} meeting_id=${JSON.stringify(bad)}`,
      );
      assertEquals(e.status, 400);
      assert(e.message.includes("meeting_id"), e.message);
    }
  }
  const parsed = notice({ kind: "no_audio" });
  assertEquals(parsed.scope, { type: "meeting", meetingId: MEETING_ID });
});

Deno.test("БЛОКИРУЮЩИЙ: у встречного отказа название не принимается — его берёт сервер из встречи", () => {
  const e = assertThrows(() => notice({ kind: "door_denied", title: "Salary review" }), NoticeError);
  assertEquals(e.status, 400);
  assert(e.message.includes("title"), e.message);
});

Deno.test("до-встречный отказ: строки встречи ещё нет — ключ календаря обязателен, meeting_id нет", () => {
  for (const kind of PRE_MEETING_KINDS) {
    assertEquals(notice({ kind }).scope, { type: "calendar", meetingKey: KEY });
    for (const bad of [undefined, "", "   ", 42]) {
      const e = assertThrows(() => parseNotice({ kind, meeting_key: bad }), NoticeError);
      assertEquals(e.status, 400);
      assert(e.message.includes("meeting_key"), e.message);
    }
    const withId = assertThrows(() => notice({ kind, meeting_id: MEETING_ID }), NoticeError);
    assertEquals(withId.status, 400);
  }
});

Deno.test("неизвестный kind отвергается и перечисляет допустимые", () => {
  const e = assertThrows(() => notice({ kind: "everything_is_fine" }), NoticeError);
  assertEquals(e.status, 400);
  assert(e.message.includes("everything_is_fine"), "в отказе должно быть видно, что именно прислали");
  assert(e.message.includes("door_waiting"), "в отказе должен быть список допустимых kind");
});

Deno.test("тело без kind и тело не-объект отвергаются, а не проглатываются", () => {
  for (const bad of [null, "door_waiting", 42, [], {}, { kind: "" }, { kind: 7 }]) {
    const e = assertThrows(() => parseNotice(bad), NoticeError, undefined, `тело ${JSON.stringify(bad)}`);
    assertEquals(e.status, 400);
  }
});

Deno.test("join_failed без detail отвергается: «не смог зайти» без причины бесполезно человеку", () => {
  const e = assertThrows(() => notice({ kind: "join_failed" }), NoticeError);
  assertEquals(e.status, 400);
  assert(e.message.includes("detail"), e.message);
});

Deno.test("язык: ru остаётся ru, всё прочее падает в английский", () => {
  assertEquals(notice({ lang: "ru" }).lang, "ru");
  assertEquals(notice({ lang: "RU-ru" }).lang, "ru");
  assertEquals(notice({ lang: "sr" }).lang, "en");
  assertEquals(notice().lang, "en");
});

Deno.test("длинные название и причина обрезаются, а не улетают простынёй в чат", () => {
  const parsed = notice({
    kind: "no_conference_link",
    title: "т".repeat(MAX_TITLE_CHARS + 50),
    detail: "d".repeat(MAX_DETAIL_CHARS + 50),
  });
  assert(parsed.title !== null && parsed.title.length <= MAX_TITLE_CHARS);
  assert(parsed.detail !== null && parsed.detail.length <= MAX_DETAIL_CHARS);
});

Deno.test("пустое название — это отсутствие названия, а не пустая строка в сообщении", () => {
  assertEquals(notice({ kind: "no_owner", title: "   " }).title, null);
  assertEquals(notice({ kind: "no_owner", title: 42 }).title, null);
});

// ── Тексты: оба языка у каждого отказа ────────────────────────────────────────

Deno.test("БЛОКИРУЮЩИЙ: у каждого отказа есть непустой текст на английском и на русском", () => {
  const keys = [...NOTICE_KINDS, "door_waiting_last"];
  for (const key of keys) {
    const entry = NOTICE_TEXTS[key as keyof typeof NOTICE_TEXTS];
    assert(entry, `нет текстов для «${key}» — отказ дойдёт до человека пустым сообщением`);
    for (const lang of NOTICE_LANGS) {
      const text = entry[lang];
      assert(
        typeof text === "string" && text.trim().length >= 20,
        `текст «${key}» на ${lang} пустой или слишком короткий, чтобы что-то объяснить`,
      );
    }
    assert(
      entry.en !== entry.ru,
      `«${key}»: русский текст совпадает с английским — перевод не заведён, а скопирован`,
    );
  }
  for (const lang of NOTICE_LANGS) {
    assert(NO_TITLE[lang].trim().length > 0, `нет замены названию на ${lang}`);
  }
});

Deno.test("каждый отказ рендерится на обоих языках без незакрытых подстановок", () => {
  for (const kind of NOTICE_KINDS) {
    for (const lang of NOTICE_LANGS) {
      for (const title of ["Weekly sync", null]) {
        // detail для join_failed обязателен, остальные рендерим БЕЗ него: иначе приписанная
        // строка с причиной делает непустым даже пустой шаблон, и тест зеленеет впустую.
        const detail = kind === "join_failed" ? "connection reset" : null;
        const text = renderNotice(notice({ kind, lang, detail }), title, 1);
        assert(text.trim().length >= 20, `${kind}/${lang}: сообщение пустое или бессодержательное`);
        assert(!/\{[a-z_]+\}/.test(text), `${kind}/${lang}: осталась подстановка — ${text}`);
        assert(!text.includes("null"), `${kind}/${lang}: в текст протекло null — ${text}`);
      }
    }
  }
});

Deno.test("у двери первое и последнее сообщения разные: повтор обязан сказать, что он последний", () => {
  const first = renderNotice(notice(), "Weekly sync", 1);
  const last = renderNotice(notice(), "Weekly sync", 2);
  assert(first !== last, "повтор дословно повторяет первое сообщение — человек не узнает, что бот уходит");
});

Deno.test("название встречи экранируется: разметка из календаря не ломает сообщение", () => {
  const text = renderNotice(notice({ kind: "no_audio" }), "<b>Совет</b> & co", 1);
  assert(text.includes("&lt;b&gt;"), `тег из названия должен быть экранирован: ${text}`);
  assert(text.includes("&amp;"), `амперсанд из названия должен быть экранирован: ${text}`);
});

Deno.test("нет названия — подставляется внятная замена, а не пустота", () => {
  for (const lang of NOTICE_LANGS) {
    const text = renderNotice(notice({ kind: "door_denied", lang }), null, 1);
    assert(text.includes(NO_TITLE[lang]), `${lang}: замена названию не подставилась — ${text}`);
  }
});
