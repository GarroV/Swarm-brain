// Один проход автозапуска по календарю (T100): календари людей → задания боту → забор.
//
// Хождение в Google и в базу вынесено в `SweepSource`, чтобы проход проверялся смоуком на стенде и
// тестом без живого календаря. Отбор встреч — _shared/calendar-dispatch.ts.
//
// Отказы громкие (D015): человек включил автозапуск, а календарь не подключён, токен мёртв, Google не
// ответил — это уходит в `skipped` с причиной уровня человека; встреча без ссылки или не в Meet —
// с причиной уровня встречи. Оркестратор пишет их в журнал, пропуски записывает missed.ts (T102).
import type { TokenResult } from "../_shared/google-calendar.ts";
import type { GEvent } from "../meeting-current/select.ts";
import {
  DISPATCH_LEAD_MS,
  type DispatchJob,
  type DispatchPlan,
  type DispatchSkip,
  dropSameRoom,
  mergeDispatch,
  planPersonDispatch,
} from "../_shared/calendar-dispatch.ts";

/** Задание, как его получает оркестратор. */
export interface TakenJob extends DispatchJob {
  id: string;
}

export interface SweepSource {
  /** Люди воркспейса, включившие автозапуск. */
  autojoinPeople(groupId: string): Promise<number[]>;
  /** Комнаты, куда бота уже позвали руками (D017): он туда едет или уже пишет (_shared/manual-rooms.ts). */
  manualRooms(groupId: string, nowMs: number): Promise<ReadonlySet<string>>;
  refreshToken(telegramId: number): Promise<string | null>;
  accessToken(refresh: string): Promise<TokenResult>;
  listEvents(token: string, timeMin: string, timeMax: string, maxResults: number): Promise<GEvent[] | null>;
  /** Задания воркспейса, чья встреча ещё не кончилась (забранные и нет): по ним видно занятые комнаты. */
  activeJobs(groupId: string, nowIso: string): Promise<DispatchJob[]>;
  /** Человек — совладелец записи задания `calendarKey` (его событие той же комнаты бот пропустил). */
  addCoInvited(groupId: string, calendarKey: string, person: number): Promise<void>;
  /** Завести задания; уже заведённые на ту же встречу воркспейса не трогаются. */
  insertJobs(groupId: string, jobs: DispatchJob[]): Promise<void>;
  /** Погасить незабранные задания воркспейса тех, кого нет в `people` (выключили автозапуск). */
  dropPendingJobsExcept(groupId: string, people: readonly number[]): Promise<void>;
  /** Забрать ожидающие задания `people`, у которых встреча ещё не кончилась. Каждое — один раз. */
  takeJobs(groupId: string, agentId: string, nowIso: string, people: readonly number[]): Promise<TakenJob[]>;
}

export interface SweepResult {
  jobs: TakenJob[];
  skipped: DispatchSkip[];
}

// Событий в окне в несколько минут у человека — единицы; предел лишь страхует от странного ответа.
const MAX_EVENTS = 25;

async function personPlan(
  source: SweepSource,
  person: number,
  nowMs: number,
  manualRooms: ReadonlySet<string>,
): Promise<DispatchPlan> {
  const skipPerson = (reason: DispatchSkip["reason"]): DispatchPlan => ({
    jobs: [],
    skipped: [{ invited_by: person, calendar_key: null, title: null, reason }],
  });
  const refresh = await source.refreshToken(person);
  if (!refresh) return skipPerson("calendar_not_connected");
  const tok = await source.accessToken(refresh);
  if (!tok.ok) return skipPerson(tok.deadGrant ? "calendar_token_dead" : "calendar_unavailable");
  // Google отбирает по пересечению: конец после timeMin, начало до timeMax. Опоздание отбор режет сам.
  const events = await source.listEvents(
    tok.token,
    new Date(nowMs).toISOString(),
    new Date(nowMs + DISPATCH_LEAD_MS + 1000).toISOString(),
    MAX_EVENTS,
  );
  if (events === null) return skipPerson("calendar_unavailable");
  return planPersonDispatch(events, person, nowMs, manualRooms);
}

export async function sweep(
  source: SweepSource,
  agent: { agentId: string; groupId: string },
  nowMs: number,
): Promise<SweepResult> {
  const nowIso = new Date(nowMs).toISOString();
  const [people, manualRooms] = await Promise.all([
    source.autojoinPeople(agent.groupId),
    source.manualRooms(agent.groupId, nowMs),
  ]);
  // Порядок людей стабилен (по telegram_id у источника): одна встреча у двоих — за первого.
  const plans = await Promise.all(people.map((p) => personPlan(source, p, nowMs, manualRooms)));
  const merged = mergeDispatch(plans);
  // Выключение автозапуска гасит и заведённые, но не забранные задания (D021): задание — не
  // согласие, согласие — флаг сейчас. Гасим ДО вставки: иначе задание выключившего держало бы
  // ключ встречи, и коллега с той же встречей остался бы без бота (вставка по ключу молчит).
  await source.dropPendingJobsExcept(agent.groupId, people);
  // Комнату, куда бот уже идёт по другому событию (прошлый проход), второй раз не занимаем.
  const fresh = dropSameRoom(merged.jobs, await source.activeJobs(agent.groupId, nowIso));
  if (fresh.kept.length > 0) await source.insertJobs(agent.groupId, fresh.kept);
  // После вставки: совладелец может быть приписан к заданию, заведённому этим же проходом.
  for (const j of [...(merged.joined ?? []), ...fresh.joined]) {
    await source.addCoInvited(agent.groupId, j.into, j.person);
  }
  // Проход идёт секунды (календари в Google), за них человек мог выключить — перечитываем
  // согласие перед самым забором. Остаётся окно между этим чтением и UPDATE забора — миллисекунды.
  const current = await source.autojoinPeople(agent.groupId);
  if (people.some((p) => !current.includes(p))) await source.dropPendingJobsExcept(agent.groupId, current);
  const jobs = await source.takeJobs(agent.groupId, agent.agentId, nowIso, current);
  return { jobs, skipped: merged.skipped };
}
