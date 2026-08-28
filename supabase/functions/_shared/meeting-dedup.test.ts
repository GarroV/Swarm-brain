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
function mockSupabase(rows: any[], meetings: any[] = []) {
  const entriesChain = {
    select: () => entriesChain,
    eq: () => entriesChain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  // Второй запрос — время кандидатов из meetings (у записей рекордера в content нет строки
  // «Дата: …, HH:MM», поэтому окно времени без этого запроса не проверить).
  const meetingsChain = {
    select: () => meetingsChain,
    in: () => Promise.resolve({ data: meetings, error: null }),
  };
  return { from: (t: string) => (t === "meetings" ? meetingsChain : entriesChain) } as never;
}

Deno.test("toMinutes — формат Postgres (timestamptz с offset), а не минуты с секундами", () => {
  // PostgREST отдаёт started_at как "2026-08-26T12:01:36+00:00". Regex по «HH:MM» хватал на такой
  // строке «01:36» (минуты и секунды) → 96 вместо 721, и ВСЕ окна времени в дедупе сравнивали
  // мусор: сигнал состава ±5 минут то пропускал дубль, то срабатывал наугад. Молчаливо, потому
  // что число выглядело правдоподобным.
  assertEquals(toMinutes("2026-08-26T12:01:36+00:00"), 12 * 60 + 1);
  assertEquals(toMinutes("2026-08-26T12:00:00+00:00"), 12 * 60);
  assertEquals(toMinutes("2026-08-26 12:01:36+00"), 12 * 60 + 1);
  assertEquals(toMinutes("2026-06-19T09:00:00Z"), 9 * 60);
  // «HH:MM» из текста встречи («Дата: 19.06.2026, 09:00») по-прежнему разбирается.
  assertEquals(toMinutes("09:30"), 570);
  assertEquals(toMinutes("Дата: 19.06.2026, 09:05"), 9 * 60 + 5);
  assertEquals(toMinutes("без времени"), null);
});

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

// ── Кросс-источниковый дедуп: ключи из РАЗНЫХ пространств имён (issue #164) ─────
// identity_key — это не идентификатор встречи, а идентификатор «как её увидел клиент»:
// <google-event>:дата (общий у всех участников), kontur:/meet:<комната> (общий), granola:<note_id>
// и manual:… (СВОИ у каждого). Гейт «оба ключа есть → ключи сравнимы» отключал дедуп целиком:
// между источниками ключи не совпадают никогда.

Deno.test("ключи из разных пространств не гейтят: recorder(calendar) ↔ granola по заголовку → дубль", async () => {
  const rows = [{
    id: "rec", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Спринт\n- пункт",
    metadata: { title: "IT+BD", identity_key: "ffvs9kgg@google.com:2026-08-26", meeting_id: "11111111-1111-4111-8111-111111111111", attendees: [{ email: "a@x.io" }] },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows, [{ id: "11111111-1111-4111-8111-111111111111", started_at: "2026-08-26T12:00:00Z" }]), {
    groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:01:41Z",
    identityKey: "granola:not_RulfChcZ3QCUEF", title: "IT+BD", attendees: [],
  });
  assertEquals(dup?.id, "rec");
});

Deno.test("granola↔granola: у каждого участника свой note_id — гейт не должен их разводить", async () => {
  const rows = [{
    id: "g1", source: "granola", is_private: false, owner_id: null,
    content: "Дата: 26.08.2026, 12:01\nУчастники: Анна, Борис",
    metadata: { title: "CEE biweekly sync", identity_key: "granola:not_AAA" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:01:00Z",
    identityKey: "granola:not_BBB", title: "CEE biweekly sync",
    attendees: [{ name: "Анна" }, { name: "Борис" }],
  });
  assertEquals(dup?.id, "g1");
});

Deno.test("два РАЗНЫХ календарных события того же дня с тем же составом → НЕ дубль (регрессия IMF BD 23.07)", async () => {
  const rows = [{
    id: "imf-regular", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Комитеты\n- пункт",
    metadata: {
      title: "IMF BD регулярная", identity_key: "eventA@google.com:2026-07-23",
      attendees: [{ name: "Vasiliy Garro" }, { name: "Anna Leonova" }, { name: "Sergey Artemov" }],
    },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-07-23", startedAt: "2026-07-23T11:30:00Z",
    identityKey: "eventB@google.com:2026-07-23", title: "IMF BD другая",
    attendees: [{ name: "Vasiliy Garro" }, { name: "Anna Leonova" }, { name: "Sergey Artemov" }],
  });
  assertEquals(dup, null);
});

// ── Сигнал «идентичный заголовок» ──────────────────────────────────────────────
// На проде (2026-08-28) одноимённых РАЗНЫХ встреч в один день нет ни одной, а Granola
// подключается к созвону позже начала (Δ до 25 мин), поэтому окно времени этот сигнал не требует.

Deno.test("идентичный заголовок ловит дубль даже при разрыве 25 минут (Granola подключилась позже)", async () => {
  const rows = [{
    id: "cal", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Тема\n- пункт",
    metadata: { title: "Настоящий рабочий мит", identity_key: "0jb48c5c@google.com:2026-07-21", meeting_id: "22222222-2222-4222-8222-222222222222" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows, [{ id: "22222222-2222-4222-8222-222222222222", started_at: "2026-07-21T13:00:00Z" }]), {
    groupId: "cee", entryDate: "2026-07-21", startedAt: "2026-07-21T13:25:12Z",
    identityKey: "granola:not_1OGqJMeGr7XXoW", title: "настоящий рабочий  мит!", attendees: [],
  });
  assertEquals(dup?.id, "cal");
});

Deno.test("похожие, но РАЗНЫЕ заголовки не склеиваются (Dodo Pizza Bulgaria ≠ Dodo Pizza Hungary)", async () => {
  const rows = [{
    id: "bg", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Тема\n- пункт",
    metadata: { title: "Dodo Pizza Bulgaria", identity_key: "evt@google.com:2026-07-23" },
  }];
  const dup = await findDuplicateMeeting(mockSupabase(rows), {
    groupId: "cee", entryDate: "2026-07-23", startedAt: "2026-07-23T13:00:07Z",
    identityKey: "granola:not_X", title: "Dodo Pizza Hungary // Marketing", attendees: [],
  });
  assertEquals(dup, null);
});

Deno.test("дефолтный/короткий заголовок сигналом не считается («Встреча», «1-1»)", async () => {
  const generic = (title: string) => [{
    id: "cand", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Тема\n- пункт", metadata: { title, identity_key: "evt@google.com:2026-08-26" },
  }];
  assertEquals(
    await findDuplicateMeeting(mockSupabase(generic("Встреча")), {
      groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:00:00Z",
      identityKey: "kontur:room1", title: "Встреча", attendees: [],
    }),
    null,
  );
  assertEquals(
    await findDuplicateMeeting(mockSupabase(generic("1-1")), {
      groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:00:00Z",
      identityKey: "granola:not_Y", title: "1-1", attendees: [],
    }),
    null,
  );
});

// ── Сигнал «публикующий есть в участниках кандидата» ───────────────────────────
// Единственный сигнал для записи из комнаты: у неё нет ни названия (заголовок вкладки — шум),
// ни участников. Живой случай 26.08: коллега писала «IT+BD» через Контур.Толк, потому что
// в её календаре события не было; в attendees календарной записи её e-mail есть.

Deno.test("запись из комнаты без названия: публикующий ∈ участники кандидата + близкое время → дубль", async () => {
  const rows = [{
    id: "cal", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Спринт\n- пункт",
    metadata: {
      title: "IT+BD", identity_key: "ffvs9kgg@google.com:2026-08-26", meeting_id: "33333333-3333-4333-8333-333333333333",
      attendees: [{ email: "V.Garro@dodobrands.io" }, { email: "i.ravilova@dodobrands.io", name: "Indira" }],
    },
  }];
  const meetings = [{ id: "33333333-3333-4333-8333-333333333333", started_at: "2026-08-26T12:00:00Z" }];
  const dup = await findDuplicateMeeting(mockSupabase(rows, meetings), {
    groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:01:36Z",
    identityKey: "kontur:c6957f9e-8e7f-45", title: "Встреча", attendees: [],
    viewerEmail: "I.Ravilova@dodobrands.io", // регистр не важен
  });
  assertEquals(dup?.id, "cal");
});

Deno.test("публикующего НЕТ в участниках кандидата → не дубль", async () => {
  const rows = [{
    id: "cal", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Спринт\n- пункт",
    metadata: {
      title: "IT+BD", identity_key: "ffvs9kgg@google.com:2026-08-26", meeting_id: "44444444-4444-4444-8444-444444444444",
      attendees: [{ email: "v.garro@dodobrands.io" }],
    },
  }];
  const meetings = [{ id: "44444444-4444-4444-8444-444444444444", started_at: "2026-08-26T12:00:00Z" }];
  const dup = await findDuplicateMeeting(mockSupabase(rows, meetings), {
    groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:01:36Z",
    identityKey: "kontur:c6957f9e-8e7f-45", title: "Встреча", attendees: [],
    viewerEmail: "someone.else@dodobrands.io",
  });
  assertEquals(dup, null);
});

Deno.test("сигнал по участнику требует близкого времени: другая встреча того же человека в тот же день → НЕ дубль", async () => {
  const rows = [{
    id: "other", source: "desktop-agent", is_private: false, owner_id: null,
    content: "### Другая встреча\n- пункт",
    metadata: {
      title: "P&L Черногория", identity_key: "6ds0j49m@google.com:2026-08-26", meeting_id: "55555555-5555-4555-8555-555555555555",
      attendees: [{ email: "i.ravilova@dodobrands.io" }],
    },
  }];
  const meetings = [{ id: "55555555-5555-4555-8555-555555555555", started_at: "2026-08-26T08:00:00Z" }];
  const dup = await findDuplicateMeeting(mockSupabase(rows, meetings), {
    groupId: "cee", entryDate: "2026-08-26", startedAt: "2026-08-26T12:01:36Z",
    identityKey: "kontur:c6957f9e-8e7f-45", title: "Встреча", attendees: [],
    viewerEmail: "i.ravilova@dodobrands.io",
  });
  assertEquals(dup, null); // 4 часа разницы — человек просто есть в инвайте другой встречи
});
