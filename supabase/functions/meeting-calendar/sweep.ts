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
  mergeDispatch,
  planPersonDispatch,
} from "../_shared/calendar-dispatch.ts";
import { type CalendarAccess, type NoticeMember, resolveNoticeRecipients } from "../_shared/notice-recipients.ts";

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
  /** Участники воркспейса с почтой — для получателей нотис бота (notice-recipients.ts). */
  workspaceMembers(groupId: string): Promise<NoticeMember[]>;
  /** Ключи встреч из `keys`, на которые задание в воркспейсе уже заведено. */
  existingJobKeys(groupId: string, keys: readonly string[]): Promise<ReadonlySet<string>>;
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

/**
 * Свой календарь участника на окно встречи — для проверки «принял» (notice-recipients.ts).
 * `null` — календаря у человека нет; исключение — не удалось прочитать (человек нотису не получит).
 */
function calendarsOf(source: SweepSource): CalendarAccess {
  return {
    async ownEvents(telegramId, job) {
      const refresh = await source.refreshToken(telegramId);
      if (!refresh) return null;
      const tok = await source.accessToken(refresh);
      if (!tok.ok) throw new Error(tok.deadGrant ? "токен календаря мёртв" : "Google не выдал токен");
      const events = await source.listEvents(tok.token, job.starts_at, job.ends_at, MAX_EVENTS);
      if (events === null) throw new Error("Google не отдал события");
      return events;
    },
  };
}

/**
 * Получатели нотис бота (кроме запустившего) — принявшие встречу участники из Swarm, по каждому
 * заданию. Не прочиталось — пусто: нотиса уйдёт одному запустившему, а задание заведётся как обычно.
 */
async function withNoticeRecipients(
  source: SweepSource,
  groupId: string,
  jobs: DispatchJob[],
): Promise<DispatchJob[]> {
  if (!jobs.some((j) => (j.attendee_emails ?? []).length > 0)) return jobs;
  let members: NoticeMember[];
  try {
    members = await source.workspaceMembers(groupId);
  } catch (e) {
    console.error(`meeting-calendar: участники воркспейса не прочитаны: ${e instanceof Error ? e.message : String(e)}`);
    return jobs;
  }
  const calendars = calendarsOf(source);
  return await Promise.all(jobs.map(async (job) => ({
    ...job,
    notice_recipients: await resolveNoticeRecipients(job, members, calendars, (l) => console.warn(l)),
  })));
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
  // Получателей считаем только для новых заданий: заведённое вставка всё равно не тронет, а
  // календари участников на каждом проходе — лишние запросы в Google, пока встреча в окне.
  const existing = merged.jobs.length > 0
    ? await source.existingJobKeys(agent.groupId, merged.jobs.map((j) => j.calendar_key))
    : new Set<string>();
  const fresh = merged.jobs.filter((j) => !existing.has(j.calendar_key));
  if (fresh.length > 0) {
    await source.insertJobs(agent.groupId, await withNoticeRecipients(source, agent.groupId, fresh));
  }
  // Проход идёт секунды (календари в Google), за них человек мог выключить — перечитываем
  // согласие перед самым забором. Остаётся окно между этим чтением и UPDATE забора — миллисекунды.
  const current = await source.autojoinPeople(agent.groupId);
  if (people.some((p) => !current.includes(p))) await source.dropPendingJobsExcept(agent.groupId, current);
  const jobs = await source.takeJobs(agent.groupId, agent.agentId, nowIso, current);
  return { jobs, skipped: merged.skipped };
}
