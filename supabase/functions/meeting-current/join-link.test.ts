import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { conferenceInfo, conferencePlatform, joinLink } from "./join-link.ts";
import type { GEvent } from "./select.ts";

// Ссылка на звонок для кнопки «Подключиться» в уведомлении рекордера (#193).
// Смысл: человек не должен идти в календарь и искать ссылку руками, когда встреча уже началась.

Deno.test("берёт видео-точку входа из conferenceData", () => {
  const ev = {
    id: "e1",
    conferenceData: {
      entryPoints: [
        { entryPointType: "more", uri: "https://meet.google.com/tel/123" },
        { entryPointType: "phone", uri: "tel:+7999" },
        {
          entryPointType: "video",
          uri: "https://meet.google.com/abc-defg-hij",
        },
      ],
    },
  } as GEvent;

  assertEquals(joinLink(ev), "https://meet.google.com/abc-defg-hij");
});

Deno.test("падает на hangoutLink, когда conferenceData нет", () => {
  const ev = {
    id: "e1",
    hangoutLink: "https://meet.google.com/xyz-1234-abc",
  } as GEvent;

  assertEquals(joinLink(ev), "https://meet.google.com/xyz-1234-abc");
});

Deno.test("conferenceData важнее hangoutLink", () => {
  const ev = {
    id: "e1",
    hangoutLink: "https://meet.google.com/старая",
    conferenceData: {
      entryPoints: [{
        entryPointType: "video",
        uri: "https://ktalk.ru/room-42",
      }],
    },
  } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/room-42");
});

Deno.test("вытаскивает ссылку из места проведения", () => {
  const ev = { id: "e1", location: "https://ktalk.ru/imf-bd-weekly" } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/imf-bd-weekly");
});

Deno.test("место проведения без ссылки ссылкой не считается", () => {
  const ev = { id: "e1", location: "Переговорка 3, второй этаж" } as GEvent;

  assertEquals(joinLink(ev), null);
});

Deno.test("находит ссылку внутри текста места проведения", () => {
  const ev = {
    id: "e1",
    location: "Zoom: https://us02web.zoom.us/j/8912345678?pwd=abc (пароль в описании)",
  } as GEvent;

  assertEquals(joinLink(ev), "https://us02web.zoom.us/j/8912345678?pwd=abc");
});

Deno.test("пропускает не-https схемы", () => {
  // Приглашение в календарь может прислать кто угодно, а ссылку рекордер ОТКРЫВАЕТ по клику.
  // Всё, кроме https, отбиваем: javascript:, file:, http: — не адрес встречи, а способ навредить.
  for (
    const location of [
      "javascript:alert(1)",
      "file:///Users/garva/secret",
      "http://ktalk.ru/room-42",
    ]
  ) {
    assertEquals(joinLink({ id: "e1", location } as GEvent), null, location);
  }

  // Те же схемы, но пришедшие из полей самого Google — проверять надо каждый источник.
  assertEquals(
    joinLink({ id: "e1", hangoutLink: "javascript:alert(1)" } as GEvent),
    null,
    "hangoutLink",
  );
  assertEquals(
    joinLink({
      id: "e1",
      conferenceData: {
        entryPoints: [{
          entryPointType: "video",
          uri: "http://ktalk.ru/room-42",
        }],
      },
    } as GEvent),
    null,
    "conferenceData",
  );
});

Deno.test("пустое событие — без ссылки", () => {
  assertEquals(joinLink({ id: "e1" } as GEvent), null);
});

Deno.test("мусор вместо uri не проходит", () => {
  const ev = {
    id: "e1",
    conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: "не ссылка" }],
    },
  } as GEvent;

  assertEquals(joinLink(ev), null);
});

// ── Площадка по хосту (conferencePlatform) ──────────────────────────────────
// Оркестратору мало ссылки: по площадке он выбирает адаптер, которым бот зайдёт в звонок.

Deno.test("площадка Google Meet", () => {
  assertEquals(
    conferencePlatform("https://meet.google.com/abc-defg-hij"),
    "meet",
  );
});

Deno.test("площадка Контур.Толк — и корень, и поддомен организации, и talk.kontur", () => {
  assertEquals(conferencePlatform("https://ktalk.ru/imf-bd-weekly"), "kontur");
  assertEquals(conferencePlatform("https://dodo.ktalk.ru/room-42"), "kontur");
  assertEquals(conferencePlatform("https://talk.kontur.ru/room-42"), "kontur");
});

Deno.test("площадка Zoom — корень и региональные поддомены", () => {
  assertEquals(conferencePlatform("https://zoom.us/j/8912345678"), "zoom");
  assertEquals(
    conferencePlatform("https://us02web.zoom.us/j/8912345678?pwd=abc"),
    "zoom",
  );
});

Deno.test("неизвестный хост — null, а не догадка", () => {
  // Teams в списке площадок нет (D008: заходим только туда, для чего есть адаптер),
  // но ссылка при этом законная — поэтому null означает «площадку не знаю», не «ссылки нет».
  assertEquals(
    conferencePlatform(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
    ),
    null,
  );
  assertEquals(conferencePlatform("https://example.com/room"), null);
});

Deno.test("мусор вместо ссылки — null", () => {
  for (
    const raw of ["", "не ссылка", "meet.google.com/abc", "javascript:alert(1)"]
  ) {
    assertEquals(conferencePlatform(raw), null, raw);
  }
});

Deno.test("подделка хоста площадкой не считается", () => {
  // Хост сравнивается целиком или по метке домена: «заканчивается на zoom.us» пропустило бы
  // evilzoom.us — домен, который может зарегистрировать кто угодно. Приглашение шлёт кто угодно.
  for (
    const raw of [
      "https://meet.google.com.evil.ru/abc-defg-hij",
      "https://evilzoom.us/j/8912345678",
      "https://talk.kontur.ru.evil.com/room",
      "https://notktalk.ru/room",
    ]
  ) {
    assertEquals(conferencePlatform(raw), null, raw);
  }
});

Deno.test("не-https площадкой не считается", () => {
  // Второй барьер к httpsOnly: в звонок бот ХОДИТ по этой ссылке, и признать площадку
  // у http-адреса значит разрешить его дальше по конвейеру.
  assertEquals(conferencePlatform("http://meet.google.com/abc-defg-hij"), null);
});

// ── Описание встречи как четвёртый источник ссылки ──────────────────────────

Deno.test("берёт ссылку из описания, когда больше её взять неоткуда", () => {
  const ev = {
    id: "e1",
    description: "Повестка: планы на квартал.\nПодключиться: https://ktalk.ru/weekly-42",
  } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/weekly-42");
});

Deno.test("в описании предпочитает ссылку известной площадки, а не первую попавшуюся", () => {
  // Описание — самое шумное поле: туда попадают повестки, документы и справка Google.
  // Первая https-ссылка там сплошь и рядом не звонок, а документ.
  const ev = {
    id: "e1",
    description: "Материалы: https://docs.google.com/document/d/abc\nЗвонок: https://us02web.zoom.us/j/8912345678",
  } as GEvent;

  assertEquals(joinLink(ev), "https://us02web.zoom.us/j/8912345678");
});

Deno.test("ссылки неизвестной площадки в описании берём как есть", () => {
  // Teams адаптера не имеет, но человеку кнопка «Подключиться» нужна: догадка лучше пустоты.
  const ev = {
    id: "e1",
    description: "Teams: https://teams.microsoft.com/l/meetup-join/19",
  } as GEvent;

  assertEquals(joinLink(ev), "https://teams.microsoft.com/l/meetup-join/19");
});

Deno.test("место проведения важнее описания", () => {
  const ev = {
    id: "e1",
    location: "https://ktalk.ru/room-iz-mesta",
    description: "https://us02web.zoom.us/j/8912345678",
  } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/room-iz-mesta");
});

Deno.test("описание без https-ссылок ссылкой не считается", () => {
  const ev = {
    id: "e1",
    description: "Созвон в переговорке 3. Ссылка http://ktalk.ru/room-42",
  } as GEvent;

  assertEquals(joinLink(ev), null);
});

// ── Ответ блока: ссылка + площадка + причина отказа ─────────────────────────

Deno.test("ссылка есть — площадка названа, причины отказа нет", () => {
  const ev = {
    id: "e1",
    hangoutLink: "https://meet.google.com/xyz-1234-abc",
  } as GEvent;

  assertEquals(conferenceInfo(ev), {
    join_url: "https://meet.google.com/xyz-1234-abc",
    platform: "meet",
  });
});

Deno.test("ссылки нет — причина названа явно, а не молчаливым null", () => {
  // Молчаливый null не давал отличить «ссылки в приглашении нет» от «ссылку не разобрали»,
  // и человеку нельзя было сказать, почему бот не пришёл.
  const ev = { id: "e1", location: "Переговорка 3, второй этаж" } as GEvent;

  assertEquals(conferenceInfo(ev), {
    join_url: null,
    platform: null,
    reason: "no_conference_link",
  });
});

Deno.test("ссылка есть, площадка незнакомая — это не отказ", () => {
  const ev = {
    id: "e1",
    location: "https://teams.microsoft.com/l/meetup-join/19",
  } as GEvent;

  assertEquals(conferenceInfo(ev), {
    join_url: "https://teams.microsoft.com/l/meetup-join/19",
    platform: null,
  });
});
