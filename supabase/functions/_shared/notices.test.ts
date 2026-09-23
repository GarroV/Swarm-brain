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
  MAX_DETAIL_CHARS,
  MAX_PER_KIND,
  MAX_PER_MEETING,
  MAX_TITLE_CHARS,
  NOTICE_KINDS,
  NOTICE_LANGS,
  NoticeError,
  parseNotice,
  renderNotice,
} from "./notices.ts";
import { NO_TITLE, NOTICE_TEXTS } from "./notice-texts.ts";

const KEY = "abc123@google.com:2026-09-23";

function notice(over: Record<string, unknown> = {}) {
  return parseNotice({ kind: "door_waiting", meeting_key: KEY, title: "Weekly sync", ...over });
}

// ── Дверь: первое уведомление, ровно один повтор, выход ───────────────────────

Deno.test("дверь: журнал пуст — первое уведомление, повтор обещан через 3 минуты", () => {
  assertEquals(decideDelivery("door_waiting", { kindCount: 0, totalCount: 0 }), {
    allow: true,
    attempt: 1,
    shouldLeave: false,
    nextReminderInSeconds: DOOR_REPEAT_SECONDS,
  });
});

Deno.test("дверь: одно уже ушло — это повтор, и он последний", () => {
  assertEquals(decideDelivery("door_waiting", { kindCount: 1, totalCount: 1 }), {
    allow: true,
    attempt: 2,
    shouldLeave: true,
    nextReminderInSeconds: null,
  });
});

Deno.test("БЛОКИРУЮЩИЙ: два уже ушло — третьего не будет, счёт по журналу", () => {
  const decision = decideDelivery("door_waiting", { kindCount: 2, totalCount: 2 });
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

// ── Поток по встрече конечен для КАЖДОГО вида, не только для двери ────────────

Deno.test("БЛОКИРУЮЩИЙ: один и тот же отказ не повторяется — «звука нет» уже сказано", () => {
  assertEquals(decideDelivery("no_audio", { kindCount: 0, totalCount: 1 }).allow, true);
  const again = decideDelivery("no_audio", { kindCount: MAX_PER_KIND, totalCount: 2 });
  assertEquals(again.allow, false);
  assert(again.allow === false);
  assert(again.reason.includes("no_audio"), again.reason);
  assertEquals(again.shouldLeave, true);
});

Deno.test("БЛОКИРУЮЩИЙ: общий потолок на встречу — дальше не шлём ничего, даже нового вида", () => {
  for (const kind of NOTICE_KINDS) {
    const decision = decideDelivery(kind, { kindCount: 0, totalCount: MAX_PER_MEETING });
    assertEquals(decision.allow, false, `${kind}: поток по встрече не ограничен`);
    assert(decision.allow === false);
    assertEquals(decision.shouldLeave, true);
  }
});

Deno.test("терминальные отказы велят уйти сразу и повтора не обещают", () => {
  for (const kind of NOTICE_KINDS.filter((k) => k !== "door_waiting")) {
    const decision = decideDelivery(kind, { kindCount: 0, totalCount: 0 });
    assert(decision.allow === true);
    assertEquals(decision.shouldLeave, true, `${kind}: боту не сказано уйти`);
    assertEquals(decision.nextReminderInSeconds, null, `${kind}: обещан повтор, которого не будет`);
  }
});

// ── Разбор запроса: мусор на границе отвергается внятно ───────────────────────

Deno.test("БЛОКИРУЮЩИЙ: без ключа встречи уведомление не принимается — считать было бы нечего", () => {
  for (const bad of [undefined, null, "", "   ", 42]) {
    const e = assertThrows(
      () => parseNotice({ kind: "no_audio", meeting_key: bad }),
      NoticeError,
      undefined,
      `meeting_key=${JSON.stringify(bad)}`,
    );
    assertEquals(e.status, 400);
    assert(e.message.includes("meeting_key"), e.message);
  }
  assertEquals(notice({ kind: "no_audio" }).meetingKey, KEY);
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
    kind: "join_failed",
    title: "т".repeat(MAX_TITLE_CHARS + 50),
    detail: "d".repeat(MAX_DETAIL_CHARS + 50),
  });
  assert(parsed.title !== null && parsed.title.length <= MAX_TITLE_CHARS);
  assert(parsed.detail !== null && parsed.detail.length <= MAX_DETAIL_CHARS);
});

Deno.test("пустое название — это отсутствие названия, а не пустая строка в сообщении", () => {
  assertEquals(notice({ title: "   " }).title, null);
  assertEquals(notice({ title: 42 }).title, null);
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
