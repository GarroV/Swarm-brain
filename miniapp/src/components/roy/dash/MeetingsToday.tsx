"use client";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useDt, useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { DashBlock, Row } from "./shared";
import { fetchTodayMeetings, openGoogleConnect, type TodayMeeting, type TodayMeetings } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";
import { hasJoined, markJoined } from "@/lib/joinedCalls";
import { canInviteBot } from "@/lib/meetingInvite";
import { InviteBotInline } from "./InviteBotInline";
import { minutesUntil, nextJoinable, nowLineIndex, reviewDraftFor } from "@/lib/homeMeetings";
import type { AgentMeeting } from "@/types";

// Право-ВЕРХ главного экрана: встречи из календаря на сегодня (issue #218).
// Решение владельца 03.09.2026: «справа вместо задач команды мы делаем модуль "встречи
// сегодня" — тянем то что есть в календаре с возможностью быстрого перехода во встречу»,
// и отдельно: «блок с грядущими встречами ставим выше, блок записанных встреч ниже».
//
// Календарь читает СЕРВЕР по OAuth-интеграции (`GET /calendar/today`) — у браузера доступа
// к календарю нет и не должно быть.
//
// `ON AIR` — «ты сам в этом звонке», `REC` — «рекордер его пишет»: два разных факта, и путать
// их нельзя (решение владельца 04.09.2026, канон —
// docs/decisions/2026-09-04-on-air-v-panele-vstrech.md). Оба приходят с сервера из heartbeat
// рекордера; локальное нажатие «Подключиться» переключает строку не дожидаясь его.

// Время слота — системным форматом локали, как в уведомлении рекордера: свой формат дат
// продукт не выдумывает (двуязычный интерфейс, ru/en дают разное).
function slot(m: TodayMeeting, locale: string): string {
  const f = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  return `${f.format(new Date(m.starts_at))} – ${f.format(new Date(m.ends_at))}`;
}

// `ON AIR` и `REC` — латиницей в обеих локалях: один термин со строкой состояния рекордера,
// где `ON AIR` живёт с 28.08.2026. Переводить их владелец отказался.
function Chip({ text, tone }: { text: string; tone: "air" | "rec" }) {
  return (
    <span
      className="shrink-0 font-bold uppercase"
      style={{
        fontSize: 9, letterSpacing: "0.05em", borderRadius: 4, padding: "1px 3.5px",
        // ON AIR — мягкая пара accent-soft/accent-ink: она контрастна в ОБЕИХ темах и
        // совпадает с подсветкой иконки строки. Белые буквы на accent-ink не годятся —
        // в тёмной теме он светло-оранжевый и текст на нём пропадает, а --surface там
        // полупрозрачный. У REC фон одинаков в обеих темах, поэтому белый текст уместен.
        background: tone === "air" ? "var(--accent-soft)" : "var(--pri-high)",
        color: tone === "air" ? "var(--accent-ink)" : "#fff",
      }}
    >
      {text}
    </span>
  );
}

function MeetingRow({ m, dt, locale, joined, onJoined }: {
  m: TodayMeeting;
  dt: (ru: string, en: string) => string;
  locale: string;
  /** Нажимали «Подключиться» в этой вкладке — сервер об этом ещё может не знать. */
  joined: boolean;
  onJoined: (m: TodayMeeting) => void;
}) {
  // Сигнал рекордера ГЛАВНЕЕ локального нажатия, но локальное срабатывает мгновенно.
  const onAir = m.on_call || joined;
  const join = () => {
    if (!m.join_url) return;
    window.open(m.join_url, "_blank", "noopener");
    onJoined(m);
  };
  // Затянувшийся созвон не приглушаем и не убираем у него кнопку: слот кончился, а люди
  // говорят — строка обязана оставаться живой.
  const dim = m.is_past && !onAir;
  return (
    <Row onClick={join}>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
        style={{
          width: 32, height: 32,
          // «Идёт сейчас» подсвечиваем акцентом, прошедшие — приглушаем: день читается
          // одним взглядом, без чтения времени у каждой строки.
          background: m.is_now || onAir ? "var(--accent-soft)" : "var(--meet-soft)",
          color: m.is_now || onAir ? "var(--accent-ink)" : "var(--meet-ink)",
          opacity: dim ? 0.55 : 1,
        }}
      >
        <RoyIcon name={m.is_now || onAir ? "mic" : "cal"} size={17} />
      </span>
      <div className="min-w-0 flex-1" style={{ opacity: dim ? 0.55 : 1 }}>
        <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
          {m.title ?? dt("Без названия", "Untitled")}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="whitespace-nowrap font-semibold"
            style={{ fontSize: 11, color: m.is_now || onAir ? "var(--accent-ink)" : "var(--meet-ink)" }}
          >
            {slot(m, locale)}
          </span>
          {onAir && <Chip text="ON AIR" tone="air" />}
          {m.recording && <Chip text="REC" tone="rec" />}
          {/* «идёт» — только когда сам ты не в звонке: рядом с ON AIR это шум. */}
          {m.is_now && !onAir && (
            <span className="font-semibold" style={{ fontSize: 10.5, color: "var(--accent-ink)" }}>
              {dt("идёт", "now")}
            </span>
          )}
          {m.attendees > 0 && !onAir && (
            <span className="whitespace-nowrap text-ink-mute" style={{ fontSize: 11 }}>
              {m.attendees === 1 ? dt("1:1", "1:1") : `${m.attendees} ${dt("уч.", "ppl")}`}
            </span>
          )}
        </div>
      </div>
      {/* Кнопка «Подключиться» — то самое «быстрый переход во встречу». Нет ссылки → нет
          кнопки: пустая кнопка обещает действие, которого не будет. */}
      <div className="flex shrink-0 items-center gap-1.5">
      {showInviteBot(m, onAir) && <InviteBotInline meetingId={m.id} joinUrl={m.join_url as string} />}
      {m.join_url && (!m.is_past || onAir) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); join(); }}
          className="shrink-0 rounded-full px-3 py-1 font-semibold transition-colors"
          style={{
            fontSize: 11.5,
            // Ты уже в звонке → звать «Подключиться» бессмысленно, но путь назад нужен:
            // вкладку легко закрыть случайно. Поэтому кнопка остаётся, но становится тихой.
            background: m.is_now && !onAir ? "var(--accent-ink)" : "var(--surface-2)",
            color: m.is_now && !onAir ? "#fff" : "var(--ink-soft)",
          }}
        >
          {onAir ? dt("Вернуться", "Back") : dt("Подключиться", "Join")}
        </button>
      )}
      </div>
    </Row>
  );
}

// «Позвать бота» — вторая точка входа к D017 (issue #636): ссылка у встречи уже есть, вставлять
// её в InviteBotCard руками незачем. Не рисуем, если площадку бот не знает (Zoom), встреча
// прошла (затянувшийся созвон с `onAir` — ещё живой) или её уже пишут (`REC`: бот не нужен).
const showInviteBot = (m: TodayMeeting, onAir: boolean) =>
  canInviteBot(m.join_url) && (!m.is_past || onAir) && !m.recording;

// Строка «Ближайших встреч» главной (экран «А», 09.11.2026): время моноширинным · точка-статус ·
// название · подпись; справа «Подключиться» у ближайшей, «Вычитать» у записанной встречи, ждущей вычитки.
// Кнопки нет, если нет ссылки: пустая кнопка «Перейти» хуже отсутствующей.
const DOT = (m: TodayMeeting, live: boolean) => (live ? "var(--primary)" : m.is_past ? "var(--status-done)" : "var(--meet-ink)");

function Amber({ children }: { children: ReactNode }) {
  return <span className="font-semibold" style={{ color: "var(--pri-med)" }}>{children}</span>;
}

/** «через 2 ч 20 мин» / «через 35 мин» / "in 2 h 20 min". */
function untilText(min: number, dt: (ru: string, en: string) => string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ru = h ? `через ${h} ч${m ? ` ${m} мин` : ""}` : `через ${m} мин`;
  const en = h ? `in ${h} h${m ? ` ${m} min` : ""}` : `in ${m} min`;
  return dt(ru, en);
}

function FlatMeetingRow({ m, dt, locale, joined, onJoined, now, primary, draft, onReview }: {
  m: TodayMeeting;
  dt: (ru: string, en: string) => string;
  locale: string;
  joined: boolean;
  onJoined: (m: TodayMeeting) => void;
  now: number;
  /** Ближайшая встреча со ссылкой: ей достаётся главная кнопка. */
  primary: boolean;
  /** Запись рекордера, ждущая вычитки (lib/homeMeetings.reviewDraftFor). */
  draft: AgentMeeting | null;
  onReview: (d: AgentMeeting) => void;
}) {
  const onAir = m.on_call || joined;
  const live = m.is_now || onAir;
  const dim = m.is_past && !onAir && !draft;
  const join = () => {
    if (!m.join_url) return;
    window.open(m.join_url, "_blank", "noopener");
    onJoined(m);
  };
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(m.starts_at));
  const until = minutesUntil(m, now);
  const people = m.attendees > 0 ? (m.attendees === 1 ? "1:1" : `${m.attendees} ${dt("участников", "attendees")}`) : null;
  const canJoin = Boolean(m.join_url) && (!m.is_past || onAir);
  return (
    <div className={`-mx-2 grid items-center gap-x-3 border-b border-line px-2 py-2.5 last:border-b-0 ${live ? "rounded-[8px] bg-accent-soft" : ""}`}
      style={{ gridTemplateColumns: "auto auto minmax(0,1fr) auto", opacity: dim ? 0.6 : 1 }}>
      <span className="font-mono font-medium text-ink-soft" style={{ fontSize: 12.5 }}>{time}</span>
      <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 7, height: 7, background: DOT(m, live) }} />
      <div className="min-w-0">
        <b className="block truncate font-semibold text-ink" style={{ fontSize: 13.5 }} title={m.title ?? undefined}>
          {m.title ?? dt("Без названия", "Untitled")}
        </b>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-mute" style={{ fontSize: 11.5 }}>
          {draft ? <><span>{dt("записана", "recorded")}</span><span>·</span><Amber>{dt("ждёт вычитки", "awaiting review")}</Amber></>
            : m.is_past && !onAir ? <span>{dt("прошла", "finished")}</span>
            : live ? <span className="font-semibold" style={{ color: "var(--accent-ink)" }}>{dt("идёт сейчас", "happening now")}</span>
            : until != null ? <span>{untilText(until, dt)}</span> : null}
          {people && !draft && <span>· {people}</span>}
          {onAir && <Chip text="ON AIR" tone="air" />}
          {m.recording && <Chip text="REC" tone="rec" />}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {draft && (
          <button type="button" onClick={() => onReview(draft)}
            className="rounded-[8px] border bg-transparent px-2.5 py-1 font-semibold transition-colors hover:bg-surface-2"
            style={{ fontSize: 11.5, borderColor: "var(--pri-med)", color: "var(--pri-med)" }}>
            {dt("Вычитать", "Review")}
          </button>
        )}
        {canJoin && showInviteBot(m, onAir) && <InviteBotInline meetingId={m.id} joinUrl={m.join_url as string} />}
        {canJoin && (
          <button type="button" onClick={join}
            className={(primary || live) && !onAir
              ? "rounded-[8px] bg-primary px-3 py-1 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              : "rounded-[8px] border border-line-2 bg-surface px-2.5 py-1 font-medium text-ink-soft transition-colors hover:text-ink"}
            style={{ fontSize: 11.5 }}>
            {onAir ? dt("Вернуться", "Back") : primary || live ? dt("Подключиться", "Join") : dt("Перейти", "Open")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Линия «сейчас» между прошедшими и будущими встречами (циан, время слева). */
function NowLine({ now, locale }: { now: number; locale: string }) {
  const t = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(now));
  return (
    <div role="separator" className="-mx-2 flex items-center gap-2.5 px-2 py-0.5">
      <span className="font-mono font-semibold text-primary" style={{ fontSize: 11 }}>{t}</span>
      <span className="h-px flex-1 bg-primary" />
    </div>
  );
}

// Пустое и «нет доступа» — словом и дорогой (стенд .cnone): пустой список при отвалившемся
// календаре читался бы как «встреч сегодня нет», а это неправда.
// Кнопка сразу ведёт в Google — тем же openGoogleConnect, что плитка календаря в настройках.
// Раньше здесь стояла ссылка на «/?settings=integrations», которую веб не читает: страница
// перезагружалась и снова писала «не подключён» (issue #824).
const connectCalendar = () => void openGoogleConnect();

function CalNote({ title, hint, action }: { title: string; hint: string; action?: { text: string } }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-[10px] border border-dashed border-line-2 px-3 py-2.5">
      <b className="font-semibold text-ink" style={{ fontSize: 13 }}>{title}</b>
      <span className="text-ink-mute" style={{ fontSize: 12 }}>{hint}</span>
      {action && (
        <button type="button" onClick={connectCalendar} className="mt-1 rounded-full bg-primary px-2.5 py-1 font-semibold text-primary-foreground" style={{ fontSize: 11.5 }}>
          {action.text}
        </button>
      )}
    </div>
  );
}

export function MeetingsToday({ className, flat, first, flatBody, drafts = [] }: {
  className?: string;
  /** Черновики рекордера (на вычитке): у встречи с такой записью — «Вычитать». Только плоский вид. */
  drafts?: AgentMeeting[];
  /** Подложка тела плоского вида (виджет главной). */
  flatBody?: string;
  /** Вид главной по стенду — надпись вместо карточки. */
  flat?: boolean;
  first?: boolean;
}) {
  const dt = useDt();
  const { setTab, push } = useRoyNav();
  const locale = dt("ru-RU", "en-US");
  // «Сейчас» для линии и подписи «через …»: обновляется раз в минуту, а не только с загрузкой данных.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  // Повторный заход — сразу с прошлым списком созвонов, обновление в фоне (#906).
  const [state, setState] = useState<{ data: TodayMeetings | null; loading: boolean; failed: boolean }>(() => ({
    data: recall<TodayMeetings>("home:today"), loading: true, failed: false,
  }));
  // Нажатия читаем ТОЛЬКО после монтирования: sessionStorage на сервере не существует, и
  // чтение прямо в рендере разошлось бы с серверной разметкой при гидрации.
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  const load = () => {
    setState((s) => ({ ...s, loading: true, failed: false }));
    fetchTodayMeetings()
      .then((data) => setState({ data: remember("home:today", data), loading: false, failed: false }))
      .catch(() => setState({ data: null, loading: false, failed: true }));
  };

  // Раз в 5 минут: слоты за день не меняются часто, а «идёт сейчас» обновлять надо —
  // иначе подсветка текущей встречи врёт до перезагрузки страницы.
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const meetings = state.data?.meetings ?? [];
  const lineAt = flat ? nowLineIndex(meetings) : null;
  const primaryId = flat ? nextJoinable(meetings)?.id : undefined;
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" }).format(new Date(now));

  useEffect(() => {
    setJoinedIds(new Set(meetings.filter((m) => hasJoined(m.id, m.ends_at)).map((m) => m.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  const markLocal = (m: TodayMeeting) => {
    markJoined(m.id, m.ends_at);
    setJoinedIds((prev) => new Set(prev).add(m.id));
  };

  const reason = state.data?.reason;

  // Календарь не подключён (или токен отвалился) — вместо текста-напоминания КНОПКА:
  // решение владельца 03.09.2026 («там же можно сделать кнопку для подключения»).
  const needsCalendar = reason === "not_connected" || reason === "token_expired";

  return (
    <DashBlock
      title={flat ? dt("Ближайшие встречи", "Upcoming meetings") : dt("Встречи сегодня", "Meetings today")}
      onHead={flat ? () => setTab("cal") : undefined}
      headAction={flat ? dt("Все встречи →", "All meetings →") : undefined}
      icon="cal"
      tint="var(--meet-ink)"
      loading={state.loading && !state.data}
      failed={state.failed}
      onRetry={load}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
      empty={!flat && !needsCalendar && meetings.length === 0}
      emptyText={reason === "calendar_error"
        ? dt("Календарь не ответил", "Calendar did not respond")
        : dt("Сегодня встреч нет", "No meetings today")}
      className={className}
      flat={flat}
      first={first}
      flatBody={flatBody}
      count={flat && !needsCalendar ? meetings.length : undefined}
    >
      {flat ? (
        needsCalendar ? (
          <CalNote
            title={reason === "token_expired" ? dt("Доступ к календарю истёк", "Calendar access expired") : dt("Календарь не подключён", "Calendar not connected")}
            hint={reason === "token_expired"
              ? dt("Google отозвал разрешение — встречи дня сейчас не приходят", "Google revoked access — today's meetings aren't coming in")
              : dt("Встречи дня и запуск рекордера берутся из Google Calendar", "Today's meetings and the recorder come from Google Calendar")}
            action={{ text: reason === "token_expired" ? dt("Переподключить", "Reconnect") : dt("Подключить календарь", "Connect calendar") }}
          />
        ) : meetings.length === 0 ? (
          reason === "calendar_error"
            ? <CalNote title={dt("Календарь не ответил", "Calendar did not respond")} hint={dt("Попробуйте обновить страницу позже", "Try reloading later")} />
            : <CalNote title={dt("Сегодня встреч нет", "No meetings today")} hint={dt("Календарь подключён — день свободен", "Calendar connected — the day is free")} />
        ) : (
          <>
            <div className="pb-1 text-ink-mute" style={{ fontSize: 11.5 }}>{dt("Сегодня", "Today")}, {dayLabel}</div>
            {meetings.map((m, i) => (
              <Fragment key={m.id}>
                {i === lineAt && <NowLine now={now} locale={locale} />}
                <FlatMeetingRow m={m} dt={dt} locale={locale} joined={joinedIds.has(m.id)} onJoined={markLocal}
                  now={now} primary={m.id === primaryId} draft={reviewDraftFor(m, drafts)}
                  onReview={(d) => push({ view: "meetingReview", params: { id: d.id } })} />
              </Fragment>
            ))}
          </>
        )
      ) : needsCalendar ? (
        <div className="py-6 text-center">
          <div className="text-ink-soft" style={{ fontSize: 12.5 }}>
            {reason === "token_expired"
              ? dt("Доступ к календарю истёк", "Calendar access expired")
              : dt("Календарь не подключён", "Calendar not connected")}
          </div>
          <button
            type="button"
            onClick={connectCalendar}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold"
            style={{ fontSize: 12, background: "var(--accent-ink)", color: "#fff" }}
          >
            <RoyIcon name="cal" size={13} strokeWidth={2} />
            {reason === "token_expired"
              ? dt("Переподключить", "Reconnect")
              : dt("Подключить календарь", "Connect calendar")}
          </button>
        </div>
      ) : (
        meetings.map((m) => (
          <MeetingRow
            key={m.id}
            m={m}
            dt={dt}
            locale={locale}
            joined={joinedIds.has(m.id)}
            onJoined={markLocal}
          />
        ))
      )}
    </DashBlock>
  );
}
