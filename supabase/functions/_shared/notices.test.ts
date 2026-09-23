// Блок notices. Здесь проверяется то, за что блок отвечает целиком: молчаливых отказов не бывает.
//
// Два теста в этом файле — блокирующие по смыслу, а не по стилю:
//   • «повтор ровно один» — потолок держит сервер. Бот с ошибкой в цикле не превращает
//     уведомление в рассылку, а человек не учится игнорировать сообщения от scriba.
//   • «у каждого отказа есть текст на обоих языках» — структурный. Добавить kind и забыть
//     текст легко, и наружу это выходит пустым сообщением в Telegram, то есть тем самым
//     молчаливым отказом, ради которого блок и заведён.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOOR_MAX_ATTEMPTS,
  DOOR_REPEAT_SECONDS,
  DOOR_WAIT_SECONDS,
  doorPolicy,
  MAX_DETAIL_CHARS,
  MAX_TITLE_CHARS,
  NOTICE_KINDS,
  NOTICE_LANGS,
  NoticeError,
  parseNotice,
  renderNotice,
} from "./notices.ts";
import { NO_TITLE, NOTICE_TEXTS } from "./notice-texts.ts";

// ── Дверь: первое уведомление, ровно один повтор, выход ───────────────────────

Deno.test("дверь: первое уведомление обещает повтор и уйти не велит", () => {
  const first = parseNotice({ kind: "door_waiting", attempt: 1, title: "Weekly sync" });
  assertEquals(doorPolicy(first), { shouldLeave: false, nextReminderInSeconds: DOOR_REPEAT_SECONDS });
});

Deno.test("дверь: второе уведомление — последнее, после него выход", () => {
  const second = parseNotice({ kind: "door_waiting", attempt: 2, title: "Weekly sync" });
  assertEquals(doorPolicy(second), { shouldLeave: true, nextReminderInSeconds: null });
});

Deno.test("БЛОКИРУЮЩИЙ: третьего уведомления о двери не существует — повтор ровно один", () => {
  const e = assertThrows(
    () => parseNotice({ kind: "door_waiting", attempt: 3, title: "Weekly sync" }),
    NoticeError,
  );
  assertEquals(e.status, 409);
  assert(
    /one reminder|ровно один|limit/i.test(e.message),
    `отказ должен объяснять, что повтор ровно один, а не просто ругаться: ${e.message}`,
  );
});

Deno.test("дверь: расписание — 90 секунд до сигнала, 180 до повтора, всего две попытки", () => {
  assertEquals(DOOR_WAIT_SECONDS, 90);
  assertEquals(DOOR_REPEAT_SECONDS, 180);
  assertEquals(DOOR_MAX_ATTEMPTS, 2);
});

Deno.test("попытка больше первой есть только у двери", () => {
  const e = assertThrows(() => parseNotice({ kind: "no_audio", attempt: 2 }), NoticeError);
  assertEquals(e.status, 400);
  assert(e.message.includes("door_waiting"), `отказ должен назвать, у кого бывает attempt: ${e.message}`);
});

// ── Разбор запроса: мусор на границе отвергается внятно ───────────────────────

Deno.test("неизвестный kind отвергается и перечисляет допустимые", () => {
  const e = assertThrows(() => parseNotice({ kind: "everything_is_fine" }), NoticeError);
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
  const e = assertThrows(() => parseNotice({ kind: "join_failed" }), NoticeError);
  assertEquals(e.status, 400);
  assert(e.message.includes("detail"), e.message);
});

Deno.test("язык: ru остаётся ru, всё прочее падает в английский", () => {
  assertEquals(parseNotice({ kind: "no_audio", lang: "ru" }).lang, "ru");
  assertEquals(parseNotice({ kind: "no_audio", lang: "RU-ru" }).lang, "ru");
  assertEquals(parseNotice({ kind: "no_audio", lang: "sr" }).lang, "en");
  assertEquals(parseNotice({ kind: "no_audio" }).lang, "en");
});

Deno.test("длинные название и причина обрезаются, а не улетают простынёй в чат", () => {
  const parsed = parseNotice({
    kind: "join_failed",
    title: "т".repeat(MAX_TITLE_CHARS + 50),
    detail: "d".repeat(MAX_DETAIL_CHARS + 50),
  });
  assert(parsed.title !== null && parsed.title.length <= MAX_TITLE_CHARS);
  assert(parsed.detail !== null && parsed.detail.length <= MAX_DETAIL_CHARS);
});

Deno.test("пустое название — это отсутствие названия, а не пустая строка в сообщении", () => {
  assertEquals(parseNotice({ kind: "no_audio", title: "   " }).title, null);
  assertEquals(parseNotice({ kind: "no_audio", title: 42 }).title, null);
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
        const text = renderNotice(parseNotice({ kind, lang, title, detail }));
        assert(text.trim().length >= 20, `${kind}/${lang}: сообщение пустое или бессодержательное`);
        assert(!/\{[a-z_]+\}/.test(text), `${kind}/${lang}: осталась подстановка — ${text}`);
        assert(!text.includes("null"), `${kind}/${lang}: в текст протекло null — ${text}`);
      }
    }
  }
});

Deno.test("у двери первое и последнее сообщения разные: повтор обязан сказать, что он последний", () => {
  const first = renderNotice(parseNotice({ kind: "door_waiting", attempt: 1, title: "Weekly sync" }));
  const last = renderNotice(parseNotice({ kind: "door_waiting", attempt: 2, title: "Weekly sync" }));
  assert(first !== last, "повтор дословно повторяет первое сообщение — человек не узнает, что бот уходит");
});

Deno.test("название встречи экранируется: разметка из календаря не ломает сообщение", () => {
  const text = renderNotice(parseNotice({ kind: "no_audio", title: "<b>Совет</b> & co" }));
  assert(text.includes("&lt;b&gt;"), `тег из названия должен быть экранирован: ${text}`);
  assert(text.includes("&amp;"), `амперсанд из названия должен быть экранирован: ${text}`);
});

Deno.test("нет названия — подставляется внятная замена, а не пустота", () => {
  for (const lang of NOTICE_LANGS) {
    const text = renderNotice(parseNotice({ kind: "door_denied", lang, title: null }));
    assert(text.includes(NO_TITLE[lang]), `${lang}: замена названию не подставилась — ${text}`);
  }
});
