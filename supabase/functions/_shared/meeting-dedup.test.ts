// Тесты дедупа встреч. Запуск: deno test supabase/functions/_shared/meeting-dedup.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  attendeeNames,
  findDuplicateMeeting,
  normName,
  parseMeetingContent,
  toMinutes,
} from "./meeting-dedup.ts";

// Мок Supabase: .from().select().eq().eq().eq().limit() → { data }.
// Возвращаемые строки задаём заранее; query-цепочка их игнорирует (фильтрацию делает сам хелпер
// in-memory, в проде фильтр по group_id/entry_date/entry_type делает PostgREST — здесь мы кормим
// уже «дневную» выборку кандидатов).
// deno-lint-ignore no-explicit-any
function mockSupabase(rows: any[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => chain } as never;
}

Deno.test("normName/toMinutes/attendeeNames — базовые", () => {
  assertEquals(normName("  Ксения   Забардаева "), "ксения забардаева");
  assertEquals(toMinutes("09:30"), 570);
  assertEquals(toMinutes("2026-06-19T09:00:00Z"), 540);
  assertEquals(toMinutes(null), null);
  assertEquals(attendeeNames([{ name: "A B" }, { email: "x@y.z" }, {}]), ["a b", "x@y.z"]);
});

Deno.test("parseMeetingContent — время и участники из контента", () => {
  const c = "Встреча: ЕТЗТЗ\nДата: 19.06.2026, 09:00\nУчастники: Ксения Забардаева, Александра\n\nСаммари: ...";
  const p = parseMeetingContent(c);
  assertEquals(p.minutes, 540);
  assertEquals(p.attendees, ["ксения забардаева", "александра"]);
});

Deno.test("мульти-участничий дубль — то же время + сильное пересечение → дубль", async () => {
  const rows = [{
    id: "existing-1",
    content: "Встреча: ЕТЗТЗ\nДата: 19.06.2026, 09:00\nУчастники: Василий, Ксения Забардаева, Александра",
    source: "granola",
    is_private: false,
    owner_id: null,
    metadata: { title: "ЕТЗТЗ" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee",
    entryDate: "2026-06-19",
    startedAt: "2026-06-19T09:03:00Z", // в пределах ±5 мин
    attendees: [{ name: "Ксения Забардаева" }, { name: "Александра" }], // overlap=2 ≥ ceil(0.5*2)
  });
  assertEquals(dup?.id, "existing-1");
});

Deno.test("ЛОЖНЫЙ дубль (реальный кейс): 1-1 vs большая встреча, общий 1 человек → НЕ дубль", async () => {
  // «Maria / Aleksandra» 08:00 (2 чел.) vs «CVM IMF» 08:15 (14 чел.), общий — только Aleksandra.
  const rows = [{
    id: "cvm",
    content: "Встреча: CVM IMF / May Review\nДата: 19.06.2026, 08:15\nУчастники: Aleksandra Mironova, Farukh Davurov, Pavel Vasko, Ekaterina Bochkareva, S Kuznetsov, Indira Ravilova, D Gorbunova, A Krasavtsev, Anna Leonova, A Nuralieva, Sergey Artemov, Vasiliy Garro, S Andreev, Ilya Kholodnov",
    source: "granola", is_private: false, owner_id: null, metadata: { title: "CVM IMF / May Review" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee",
    entryDate: "2026-06-19",
    startedAt: "2026-06-19T08:00:00Z",
    attendees: [{ name: "Aleksandra Mironova" }, { name: "Maria Molchanova" }],
  });
  assertEquals(dup, null); // overlap=1 < 2 → не склеиваем разные встречи
});

Deno.test("частичное пересечение состава (<половины) на том же времени → НЕ дубль", async () => {
  const rows = [{
    id: "big", content: "Встреча: A\nДата: 19.06.2026, 09:00\nУчастники: A, B, X, Y, Z",
    source: "granola", is_private: false, owner_id: null, metadata: { title: "A" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-06-19", startedAt: "2026-06-19T09:00:00Z",
    attendees: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }], // overlap=2, small=5 → нужно ≥3
  });
  assertEquals(dup, null);
});

Deno.test("«1-1» в тот же день, но другое время → НЕ дубль", async () => {
  const rows = [{
    id: "existing-0900",
    content: "Встреча: 1-1\nДата: 26.06.2026, 09:00\nУчастники: Александра, Василий",
    source: "granola",
    is_private: false,
    owner_id: null,
    metadata: { title: "1-1" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee",
    entryDate: "2026-06-26",
    startedAt: "2026-06-26T10:00:00Z", // 60 мин разницы — другая встреча
    attendees: [{ name: "Александра" }, { name: "Анна" }], // overlap = Александра (1)
  });
  assertEquals(dup, null);
});

Deno.test("нет участников у входящей → НЕ дедупим", async () => {
  const rows = [{ id: "x", content: "Дата: 19.06.2026, 09:00\nУчастники: А", source: "granola", is_private: false, owner_id: null, metadata: {} }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-06-19", startedAt: "2026-06-19T09:00:00Z", attendees: [],
  });
  assertEquals(dup, null);
});

Deno.test("нет даты у входящей → НЕ дедупим", async () => {
  const rows = [{ id: "x", content: "Дата: 19.06.2026, 09:00\nУчастники: Анна", source: "granola", is_private: false, owner_id: null, metadata: {} }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: null, startedAt: "09:00", attendees: [{ name: "Анна" }],
  });
  assertEquals(dup, null);
});

Deno.test("время неизвестно у кандидата: overlap=1 → НЕ дубль, overlap≥2 → дубль", async () => {
  const base = { id: "no-time", source: "desktop-agent", is_private: false, owner_id: null };
  // кандидат без "Дата: …, HH:MM", участники только в metadata.attendees (как у рекордера)
  const rows = [{
    ...base,
    content: "### Тема\n- пункт",
    metadata: { title: "Без времени", attendees: [{ name: "Анна" }, { name: "Борис" }] },
  }];
  const one = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-06-19", startedAt: "2026-06-19T09:00:00Z", attendees: [{ name: "Анна" }],
  });
  assertEquals(one, null); // overlap=1, время кандидата неизвестно → недостаточно

  const two = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-06-19", startedAt: "2026-06-19T09:00:00Z", attendees: [{ name: "Анна" }, { name: "Борис" }],
  });
  assertEquals(two?.id, "no-time"); // overlap=2 → дубль
});

Deno.test("identity_key: разные ключи того же дня + идентичный состав → НЕ дубль (кейс IMF BD 23.07)", async () => {
  // Кандидат — запись рекордера без "Дата:" в content (время не парсится), но с identity_key в metadata.
  const rows = [{
    id: "imf-regular", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Комитеты по согласованию помещений\n- пункт",
    metadata: {
      title: "IMF BD регулярная", identity_key: "eventA@google.com:2026-07-23",
      attendees: [{ name: "Vasiliy Garro" }, { name: "Anna Leonova" }, { name: "Sergey Artemov" }],
    },
  }];
  // Входящая — ДРУГОЕ событие того же дня с тем же составом (регулярный командный созвон).
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-07-23", startedAt: "2026-07-23T11:30:00Z",
    identityKey: "eventB@google.com:2026-07-23",
    attendees: [{ name: "Vasiliy Garro" }, { name: "Anna Leonova" }, { name: "Sergey Artemov" }],
  });
  assertEquals(dup, null); // разные identity_key → разные встречи, склеивать нельзя
});

Deno.test("identity_key: тот же ключ → дубль (одна встреча, два рекордера)", async () => {
  const rows = [{
    id: "same", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Тема\n- пункт",
    metadata: { title: "Встреча", identity_key: "eventA@google.com:2026-07-23", attendees: [{ name: "Vasiliy Garro" }] },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-07-23", startedAt: "2026-07-23T08:00:00Z",
    identityKey: "eventA@google.com:2026-07-23",
    attendees: [{ name: "Vasiliy Garro" }, { name: "Someone Else" }], // состав чуть иной — неважно
  });
  assertEquals(dup?.id, "same"); // тот же ключ → та же встреча
});

Deno.test("identity_key только у входящей, кандидат без ключа → эвристика (кросс-источник recorder→granola)", async () => {
  // Granola-запись: время в content, identity_key отсутствует → гейт пропускается, работает эвристика.
  const rows = [{
    id: "granola", source: "granola", is_private: false, owner_id: null,
    content: "Дата: 23.07.2026, 08:02\nУчастники: Анна, Борис",
    metadata: { title: "Granola" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-07-23", startedAt: "2026-07-23T08:00:00Z",
    identityKey: "eventA@google.com:2026-07-23", // есть у входящей, нет у кандидата
    attendees: [{ name: "Анна" }, { name: "Борис" }],
  });
  assertEquals(dup?.id, "granola"); // гейт пропущен → эвристика: время близко + overlap=2 → дубль
});

// ── Приватность: фильтр ВНУТРИ, а не «на совести вызывающего» (issue #45) ──────
// Раньше функция возвращала чужую личную встречу с флагами isPrivate/ownerId и полагалась на то,
// что каждый вызывающий отфильтрует сам. Из четырёх мест фильтровало одно: заголовок чужой личной
// встречи уходил в Telegram, id и title отдавались наружу, а входящая встреча из Read.ai молча
// выбрасывалась как «дубль» того, чего вызывающий не имеет права видеть.

const PRIVATE_ROW = [{
  id: "priv", content: "Дата: 19.06.2026, 09:00\nУчастники: Анна, Борис", source: "granola",
  is_private: true, owner_id: 999, metadata: { title: "Личная" },
}];
const SAME_MEETING = {
  groupId: "cee", entryDate: "2026-06-19", startedAt: "2026-06-19T09:00:00Z",
  attendees: [{ name: "Анна" }, { name: "Борис" }],
};

Deno.test("чужая личная встреча НЕ возвращается как дубль (утечка + потеря данных)", async () => {
  const dup = await findDuplicateMeeting(mockSupabase(PRIVATE_ROW), { ...SAME_MEETING, viewerId: 111 });
  assertEquals(dup, null);
});

Deno.test("своя личная встреча дублем считается (владелец её видит)", async () => {
  const dup = await findDuplicateMeeting(mockSupabase(PRIVATE_ROW), { ...SAME_MEETING, viewerId: 999 });
  assertEquals(dup?.id, "priv");
  assertEquals(dup?.isPrivate, true);
});

Deno.test("без viewerId (системный вызов) приватные кандидаты отбрасываются — fail-closed", async () => {
  const dup = await findDuplicateMeeting(mockSupabase(PRIVATE_ROW), SAME_MEETING);
  assertEquals(dup, null);
});

Deno.test("командная встреча остаётся дублем для любого — фильтр не сломал дедуп", async () => {
  const rows = [{
    id: "team", content: "Дата: 19.06.2026, 09:00\nУчастники: Анна, Борис", source: "granola",
    is_private: false, owner_id: null, metadata: { title: "Общая" },
  }];
  assertEquals((await findDuplicateMeeting(mockSupabase(rows), { ...SAME_MEETING, viewerId: 111 }))?.id, "team");
  assertEquals((await findDuplicateMeeting(mockSupabase(rows), SAME_MEETING))?.id, "team");
});
