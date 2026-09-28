// Один проход автозапуска по календарю (T100): календари людей → задания боту → забор.
//
// Хождение в Google и в базу вынесено в `SweepSource`, чтобы проход проверялся смоуком на стенде и
// тестом без живого календаря. Отбор встреч — _shared/calendar-dispatch.ts.
//
// Отказы громкие (D015): человек включил автозапуск, а календарь не подключён, токен мёртв, Google не
// ответил — это уходит в `skipped` с причиной уровня человека; встреча без ссылки или не в Meet —
// с причиной уровня встречи. Оркестратор пишет их в журнал; сигнал человеку — отдельная задача (T102).
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
import { parseInviteLink } from "../_shared/meeting-invite.ts";

/** Задание, как его получает оркестратор. */
export interface TakenJob extends DispatchJob {
  id: string;
}

export interface SweepSource {
  /** Люди воркспейса, включившие автозапуск. */
  autojoinPeople(groupId: string): Promise<number[]>;
  /** Ссылки живых ручных приглашений воркспейса (D017): на эти комнаты бот уже идёт. */
  liveInviteLinks(groupId: string, nowIso: string): Promise<string[]>;
  refreshToken(telegramId: number): Promise<string | null>;
  accessToken(refresh: string): Promise<TokenResult>;
  listEvents(token: string, timeMin: string, timeMax: string, maxResults: number): Promise<GEvent[] | null>;
  /** Завести задания; уже заведённые на ту же встречу воркспейса не трогаются. */
  insertJobs(groupId: string, jobs: DispatchJob[]): Promise<void>;
  /** Забрать ожидающие задания воркспейса, у которых встреча ещё не кончилась. Каждое — один раз. */
  takeJobs(groupId: string, agentId: string, nowIso: string): Promise<TakenJob[]>;
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
  const [people, links] = await Promise.all([
    source.autojoinPeople(agent.groupId),
    source.liveInviteLinks(agent.groupId, nowIso),
  ]);
  const manualRooms = new Set(
    links.map((l) => parseInviteLink(l)?.room).filter((r): r is string => r !== undefined),
  );
  // Порядок людей стабилен (по telegram_id у источника): одна встреча у двоих — за первого.
  const plans = await Promise.all(people.map((p) => personPlan(source, p, nowMs, manualRooms)));
  const merged = mergeDispatch(plans);
  if (merged.jobs.length > 0) await source.insertJobs(agent.groupId, merged.jobs);
  const jobs = await source.takeJobs(agent.groupId, agent.agentId, nowIso);
  return { jobs, skipped: merged.skipped };
}
