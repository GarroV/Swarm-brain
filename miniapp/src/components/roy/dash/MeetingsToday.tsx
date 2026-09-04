"use client";
import { useEffect, useState } from "react";
import { useDt } from "../nav";
import { RoyIcon } from "../icons";
import { DashBlock, Row } from "./shared";
import { fetchTodayMeetings, type TodayMeeting, type TodayMeetings } from "@/lib/api";
import { hasJoined, markJoined } from "@/lib/joinedCalls";

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
    </Row>
  );
}

export function MeetingsToday({ className }: { className?: string }) {
  const dt = useDt();
  const locale = dt("ru-RU", "en-US");
  const [state, setState] = useState<{ data: TodayMeetings | null; loading: boolean; failed: boolean }>({
    data: null, loading: true, failed: false,
  });
  // Нажатия читаем ТОЛЬКО после монтирования: sessionStorage на сервере не существует, и
  // чтение прямо в рендере разошлось бы с серверной разметкой при гидрации.
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  const load = () => {
    setState((s) => ({ ...s, loading: true, failed: false }));
    fetchTodayMeetings()
      .then((data) => setState({ data, loading: false, failed: false }))
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
      title={dt("Встречи сегодня", "Meetings today")}
      icon="cal"
      tint="var(--meet-ink)"
      loading={state.loading && !state.data}
      failed={state.failed}
      onRetry={load}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
      empty={!needsCalendar && meetings.length === 0}
      emptyText={reason === "calendar_error"
        ? dt("Календарь не ответил", "Calendar did not respond")
        : dt("Сегодня встреч нет", "No meetings today")}
      className={className}
    >
      {needsCalendar ? (
        <div className="py-6 text-center">
          <div className="text-ink-soft" style={{ fontSize: 12.5 }}>
            {reason === "token_expired"
              ? dt("Доступ к календарю истёк", "Calendar access expired")
              : dt("Календарь не подключён", "Calendar not connected")}
          </div>
          <a
            href="/?settings=integrations"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold"
            style={{ fontSize: 12, background: "var(--accent-ink)", color: "#fff" }}
          >
            <RoyIcon name="cal" size={13} strokeWidth={2} />
            {reason === "token_expired"
              ? dt("Переподключить", "Reconnect")
              : dt("Подключить календарь", "Connect calendar")}
          </a>
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
