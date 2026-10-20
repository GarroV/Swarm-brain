import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertStalledMeetings,
  MAX_ALERTS_PER_HOUR,
  PRIVATE_MEETING_LABEL,
  stalledMeetingText,
} from "./stalled-meeting-alerts.ts";
import { STALL_MINUTES } from "./ai-health.ts";
import { makeFakeDb, type Row } from "./workspace-keys.fake.ts";

const MIN = 60_000;
const NOW = new Date("2026-10-19T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * MIN).toISOString();
const MASTER = 900;

// Получатели — все мастера (константа владельца 744230399 тоже мастер); у каждого своя видимость названия.
const all: Array<{ to: number; text: string }> = [];
const send = (to: number, text: string) => {
  all.push({ to, text });
  return Promise.resolve();
};
/** Что получил MASTER — он записавший свои черновики, поэтому видит названия. */
const sent = {
  get length() {
    return all.filter((s) => s.to === MASTER).length;
  },
  get items() {
    return all.filter((s) => s.to === MASTER);
  },
};

function meeting(id: string, over: Row = {}): Row {
  return {
    id,
    title: `Встреча ${id}`,
    entry_id: null,
    group_id: "cee",
    summary_status: "processing",
    process_state: { stage: "summarize" },
    recorders: [{ telegram_id: MASTER }],
    co_owners: [],
    created_at: ago(120),
    ended_at: null,
    last_progress_at: ago(STALL_MINUTES + 5),
    ...over,
  };
}

function setup(meetings: Row[], extra: Record<string, Row[]> = {}) {
  all.length = 0;
  return makeFakeDb({
    workspaces: [{ id: "cee", name: "IMF BD" }],
    master_admins: [{ telegram_id: MASTER }],
    meetings,
    ...extra,
  });
}

Deno.test("застрявшая встреча — тревога мастеру дословным текстом; свежая и завершённая не трогаются", async () => {
  const db = setup([
    meeting("a"),
    meeting("fresh", { last_progress_at: ago(STALL_MINUTES - 5) }),
    meeting("done", { summary_status: "done" }),
  ]);
  assertEquals(await alertStalledMeetings(db.client, NOW, send), 1);
  assertEquals(sent.items, [{
    to: MASTER,
    text:
      "Встреча «Встреча a» в пространстве «IMF BD» застряла в обработке дольше 30 минут (этап: summarize). Нужно разобраться.",
  }]);
  assertEquals(stalledMeetingText("x", "y", "z").includes("«x»"), true);
});

Deno.test("одна встреча — одна тревога; новая застрявшая — новая тревога", async () => {
  const db = setup([meeting("a")]);
  await alertStalledMeetings(db.client, NOW, send);
  await alertStalledMeetings(db.client, new Date(NOW.getTime() + 10 * MIN), send);
  assertEquals(sent.length, 1, "повторный тик по той же встрече молчит");
  db.tables.meetings.push(meeting("b"));
  await alertStalledMeetings(db.client, new Date(NOW.getTime() + 20 * MIN), send);
  assertEquals(sent.length, 2);
  assert(sent.items[1].text.includes("Встреча b"));
});

Deno.test("потолок: не больше MAX_ALERTS_PER_HOUR за час, остальные уходят позже, каждая один раз", async () => {
  const db = setup(["a", "b", "c", "d", "e"].map((id, i) => meeting(id, { created_at: ago(300 - i) })));
  await alertStalledMeetings(db.client, NOW, send);
  assertEquals(sent.length, MAX_ALERTS_PER_HOUR);
  await alertStalledMeetings(db.client, new Date(NOW.getTime() + 30 * MIN), send);
  assertEquals(sent.length, MAX_ALERTS_PER_HOUR, "в пределах часа новых нет");
  await alertStalledMeetings(db.client, new Date(NOW.getTime() + 61 * MIN), send);
  assertEquals(sent.length, 5, "через час — остаток, без повторов уже оповещённых");
  assertEquals(new Set(sent.items.map((s) => s.text)).size, 5);
});

Deno.test("не получил никто — право возвращается, следующий тик пробует снова", async () => {
  const db = setup([meeting("a")]);
  await alertStalledMeetings(db.client, NOW, () => Promise.reject(new Error("telegram down")));
  assertEquals(db.tables.stalled_meeting_alerts?.length ?? 0, 0);
  assertEquals(await alertStalledMeetings(db.client, NOW, send), 1);
});

Deno.test("приватность: чужой черновик и недоступная запись — «личная встреча», видимая — с названием", async () => {
  const db = setup(
    [
      meeting("own"),
      meeting("foreign", { recorders: [{ telegram_id: 5 }] }),
      meeting("priv", { entry_id: "e1", recorders: [{ telegram_id: 5 }] }),
      meeting("shared", { entry_id: "e2", recorders: [{ telegram_id: 5 }] }),
      meeting("mine", { entry_id: "e3", recorders: [{ telegram_id: 5 }] }),
    ],
    {
      entries: [
        { id: "e1", is_private: true, owner_id: 5, shared_with: [], archived_at: null },
        { id: "e2", is_private: false, owner_id: 5, shared_with: [], archived_at: null },
        { id: "e3", is_private: true, owner_id: MASTER, shared_with: [], archived_at: null },
      ],
    },
  );
  // потолок не мешает проверке видимости
  assertEquals(await alertStalledMeetings(db.client, NOW, send), MAX_ALERTS_PER_HOUR);
  await alertStalledMeetings(db.client, new Date(NOW.getTime() + 61 * MIN), send);
  const texts = sent.items.map((s) => s.text);
  assert(texts.some((t) => t.includes("«Встреча own»")), "свой черновик с названием");
  const owner = all.filter((s) => s.to !== MASTER).map((s) => s.text);
  assertEquals(owner.length, 5, "второй мастер получает по тревоге на встречу");
  assert(
    owner.every((t) => t.includes(`«${PRIVATE_MEETING_LABEL}»`) || t.includes("«Встреча shared»")),
    "второй мастер: чужое без названий",
  );
  assertEquals(
    texts.filter((t) => t.includes(`«${PRIVATE_MEETING_LABEL}»`)).length,
    2,
    "чужой черновик и чужая личная запись",
  );
  assert(texts.some((t) => t.includes("«Встреча shared»")), "общая запись видна");
  assert(texts.some((t) => t.includes("«Встреча mine»")), "своя личная запись видна");
  assert(
    texts.every((t) => !t.includes("Встреча priv") && !t.includes("Встреча foreign")),
    "названия чужого не утекают",
  );
});
