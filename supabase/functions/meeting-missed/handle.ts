// meeting-missed — логика ручки (T102, решения D015/D021/D022). index.ts подставляет настоящие
// Supabase и Google, тест — поддельные.
//
// Рекордер человека (bumblebee) под СВОИМ токеном спрашивает: на какие мои встречи бот не пошёл или
// не дошёл — и одним действием зовёт бота руками на такую встречу (приглашение D017).
//
// GET: в Google НЕ ходит (T164, D023). Календарь человека снимает по расписанию
// meeting-calendar-snapshot; здесь идущие встречи из его последнего снимка сверяются с заданиями:
// задания нет или его никто не забрал → служба автозапуска не отозвалась (not_picked_up); забрал, но
// в звонке нет и ничего не сказал → not_arrived. Так пропуск виден и тогда, когда оркестратор лежит и
// сам ничего не пишет. Найденное записывается в meeting_calendar_misses, в ответ идут открытые
// пропуски человека. Причины уровня человека (календаря нет / доступ умер) пишет сам снимок.
// POST { miss_id }: позвать бота на встречу пропуска — заводится обычное ручное приглашение (правила
// те же, что у веба: swarm-api/meeting-invites.ts), пропуск закрывается им (invite_id).
import {
  arrivalCheckDue,
  canInvite,
  missMessage,
  type MissRecord,
  notArrivedMiss,
  type OngoingPlan,
  personMissKey,
  pickupMiss,
} from "../_shared/calendar-missed.ts";
import {
  ongoingFromSnapshot,
  snapshotChecked,
  type SnapshotEvent,
  type SnapshotRun,
} from "../_shared/calendar-snapshot.ts";
import type { JobRow, MissRow, MissStore } from "../_shared/calendar-miss-store.ts";
import { parseInviteLink } from "../_shared/meeting-invite.ts";

/** Человек, чей рекордер спрашивает. */
export interface Person {
  telegramId: number;
  groupId: string;
}

export interface MissedDeps {
  /** Дверь: только токен рекордера самого человека. Отказ — готовый ответ. */
  identify(req: Request): Promise<Person | Response>;
  autojoin(telegramId: number): Promise<boolean>;
  /** Последняя попытка снять календарь человека (meeting_calendar_snapshot_runs), или null. */
  snapshotRun(person: Person): Promise<SnapshotRun | null>;
  /** Встречи снимка `snapshotAt`, идущие в момент `nowIso`. */
  snapshotEvents(person: Person, snapshotAt: string, nowIso: string): Promise<SnapshotEvent[]>;
  /** Ссылки приглашений воркспейса, заведённых с `sinceIso` (любого статуса): туда бота уже звали. */
  recentInviteLinks(groupId: string, sinceIso: string): Promise<string[]>;
  store: MissStore;
  /** Пропуски человека без приглашения, замеченные с `sinceIso`. */
  openMisses(person: Person, sinceIso: string): Promise<MissRow[]>;
  missById(person: Person, id: string): Promise<MissRow | null>;
  attachInvite(missId: string, inviteId: string): Promise<void>;
  /** Завести ручное приглашение от имени человека (правила веба) — ответ как у POST /meeting-invites. */
  createInvite(person: Person, joinUrl: string): Promise<Response>;
  /** Прочитать своё приглашение — ответ как у GET /meeting-invites/:id. */
  readInvite(person: Person, inviteId: string): Promise<Response>;
  log(line: string): void;
  now(): number;
}

/** Сколько назад смотреть приглашения и пропуски: дольше встречи не длятся. */
export const LOOKBACK_MS = 12 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS = {
  bad_request: { status: 400, en: "Send {miss_id}", ru: "Нужно {miss_id}" },
  not_found: { status: 404, en: "Missed meeting not found", ru: "Пропуск не найден" },
  cannot_invite: {
    status: 409,
    en: "The bot can't be invited to this meeting — it only joins Google Meet by a valid link",
    ru: "На эту встречу бота не позвать — он ходит только в Google Meet по рабочей ссылке",
  },
  meeting_over: { status: 409, en: "This meeting is already over", ru: "Эта встреча уже закончилась" },
  autojoin_off: {
    status: 409,
    en: "scriba autostart is off for you",
    ru: "У вас выключен автозапуск scriba",
  },
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function err(code: keyof typeof ERRORS): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function roomsOf(links: readonly string[]): Set<string> {
  return new Set(links.map((l) => parseInviteLink(l)?.room).filter((r): r is string => r !== undefined));
}

async function jobMisses(
  deps: MissedDeps,
  person: Person,
  jobs: OngoingPlan["jobs"],
  nowMs: number,
): Promise<MissRecord[]> {
  const rows = await deps.store.jobsFor(person.groupId, jobs.map((j) => j.calendar_key));
  const byKey = new Map<string, JobRow>(rows.map((r) => [r.calendar_key, r]));
  const misses: MissRecord[] = [];
  for (const job of jobs) {
    const row = byKey.get(job.calendar_key) ?? null;
    const pickup = pickupMiss(job, row, nowMs, person.telegramId);
    if (pickup !== null) misses.push(pickup);
    if (row === null || !arrivalCheckDue(row, nowMs)) continue;
    // Нотису бот шлёт владельцу задания — по нему и смотрим, сказано ли уже.
    const evidence = await deps.store.arrivalEvidence(person.groupId, row.calendar_key, row.invited_by);
    const lost = notArrivedMiss(row, evidence, person.telegramId);
    if (lost !== null) misses.push(lost);
  }
  return misses;
}

/** Пропуски идущих встреч по снимку календаря. Google не зовётся; бросает только сбой базы. */
async function snapshotMisses(
  deps: MissedDeps,
  person: Person,
  run: SnapshotRun | null,
  rooms: ReadonlySet<string>,
  nowMs: number,
): Promise<MissRecord[]> {
  if (run?.snapshot_at == null) return [];
  const rows = await deps.snapshotEvents(person, run.snapshot_at, new Date(nowMs).toISOString());
  const plan = ongoingFromSnapshot(rows, person.telegramId, nowMs, rooms);
  return [...plan.misses, ...await jobMisses(deps, person, plan.jobs, nowMs)];
}

function isOpen(miss: MissRow, nowMs: number): boolean {
  if (miss.calendar_key === null) return miss.miss_key === personMissKey(nowMs);
  return miss.ends_at !== null && Date.parse(miss.ends_at) > nowMs;
}

/** Бот всё-таки на встрече или на неё уже позвали руками — пропуск больше не пропуск. */
async function stillMissed(deps: MissedDeps, person: Person, miss: MissRow, rooms: ReadonlySet<string>) {
  if (miss.calendar_key === null || !canInvite(miss)) return true;
  const room = miss.join_url === null ? undefined : parseInviteLink(miss.join_url)?.room;
  if (room !== undefined && rooms.has(room)) return false;
  // Служба ожила и забрала задание — бот едет; не дойдёт — это уже not_arrived.
  if (miss.reason === "not_picked_up") {
    const rows = await deps.store.jobsFor(person.groupId, [miss.calendar_key]);
    if (rows.some((r) => r.taken_at !== null)) return false;
  }
  const evidence = await deps.store.arrivalEvidence(person.groupId, miss.calendar_key, person.telegramId);
  return !evidence.botSeen;
}

function view(miss: MissRow) {
  return {
    id: miss.id,
    reason: miss.reason,
    title: miss.title,
    starts_at: miss.starts_at,
    ends_at: miss.ends_at,
    join_url: miss.join_url,
    platform: miss.platform,
    detected_at: miss.detected_at,
    can_invite: canInvite(miss),
    message: missMessage(miss),
  };
}

async function list(deps: MissedDeps, person: Person): Promise<Response> {
  if (!(await deps.autojoin(person.telegramId))) {
    return json({ autojoin: false, checked: false, snapshot_at: null, misses: [] });
  }
  const nowMs = deps.now();
  const since = new Date(nowMs - LOOKBACK_MS).toISOString();
  const rooms = roomsOf(await deps.recentInviteLinks(person.groupId, since));

  let run: SnapshotRun | null = null;
  let checked = false;
  try {
    run = await deps.snapshotRun(person);
    checked = snapshotChecked(run, nowMs);
    await deps.store.recordMisses(person.groupId, await snapshotMisses(deps, person, run, rooms, nowMs));
  } catch (e) {
    // Сбой сверки — не отказ: записанное раньше всё равно показываем, и честно говорим, что свежей
    // проверки не было.
    checked = false;
    deps.log(`meeting-missed: сверка по снимку ${person.telegramId} не удалась: ${describe(e)}`);
  }

  const open: MissRow[] = [];
  for (const miss of await deps.openMisses(person, since)) {
    if (isOpen(miss, nowMs) && await stillMissed(deps, person, miss, rooms)) open.push(miss);
  }
  return json({ autojoin: true, checked, snapshot_at: run?.snapshot_at ?? null, misses: open.map(view) });
}

async function readBody(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { miss_id?: unknown };
    return typeof body.miss_id === "string" && UUID.test(body.miss_id) ? body.miss_id.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function inviteFromMiss(deps: MissedDeps, person: Person, req: Request): Promise<Response> {
  const missId = await readBody(req);
  if (missId === null) return err("bad_request");
  if (!(await deps.autojoin(person.telegramId))) return err("autojoin_off");
  const miss = await deps.missById(person, missId);
  if (miss === null) return err("not_found");
  // Уже звали по этому пропуску — отдаём то же приглашение, а не второе.
  if (miss.invite_id !== null) return await deps.readInvite(person, miss.invite_id);
  if (!canInvite(miss) || miss.join_url === null) return err("cannot_invite");
  if (miss.ends_at === null || Date.parse(miss.ends_at) <= deps.now()) return err("meeting_over");

  const res = await deps.createInvite(person, miss.join_url);
  if (res.status !== 200 && res.status !== 201) return res;
  const body = (await res.clone().json()) as { invite?: { id?: unknown } };
  if (typeof body.invite?.id === "string") {
    await deps.attachInvite(miss.id, body.invite.id);
    deps.log(`meeting-missed: ${person.telegramId} позвал бота по пропуску ${miss.id} → ${body.invite.id}`);
  }
  return res;
}

export async function handleMissed(req: Request, deps: MissedDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "GET — missed meetings; POST {miss_id} — invite the bot" }, 405);
  }
  const person = await deps.identify(req);
  if (person instanceof Response) return person;
  try {
    return req.method === "GET" ? await list(deps, person) : await inviteFromMiss(deps, person, req);
  } catch (e) {
    deps.log(`meeting-missed: ${req.method} ${person.telegramId} — сбой: ${describe(e)}`);
    return json({ error: "missed meetings unavailable" }, 500);
  }
}
