"use client";
// Плашка «скоро обновление» — пилюля по центру сверху, своей тонкой строкой над контентом.
//
// Зачем: пуш в `main` пересобирает веб, после чего service worker сам перезагружает открытые
// страницы (`controllerchange` в ServiceWorkerRegister). Без предупреждения человек, который
// правит тезисы, получает перезагрузку под руками — 27.08.2026 это чуть не случилось с живой
// вычиткой. Канон решения: docs/decisions/2026-08-27-deploy-notice.md
//
// Своего поллинга НЕТ: объявление приезжает прицепом к ленте уведомлений (колокольчик
// публикует его в стор), а отсчёт тикает локально из `at`. Один fetch на маунте склеивается
// с маунт-запросом колокольчика общим кэшем запросов (request-cache, TTL 2.5 с).
//
// Оформление — только токены системы: янтарная пара accent-soft/accent-ink (та же, что у чипа
// пинга) для предупреждения и filled primary в момент раскатки. Красный (`--destructive`)
// намеренно НЕ используется: он у нас означает просрочку и ошибку, а обновление — не ошибка.
import { useEffect, useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { fetchNotifications } from "@/lib/api";
import {
  lastNotice,
  noticeView,
  publishNotice,
  subscribeNotice,
  type DeployNotice,
} from "@/lib/deployNotice";

// Отсчёт в минутах — раз в 20 с достаточно, чтобы цифра не отставала заметно. Запросов не шлём.
const TICK_MS = 20_000;

export function DeployNoticeBar() {
  const dt = useDt();
  const { me } = useRoyNav();
  const [notice, setNotice] = useState<DeployNotice | null>(lastNotice);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => subscribeNotice(setNotice), []);

  // Первое знание об объявлении: колокольчик мог ещё не успеть опросить ленту.
  useEffect(() => {
    if (lastNotice()) return;
    let alive = true;
    fetchNotifications()
      .then((res) => { if (alive) publishNotice(res.notice ?? null); })
      .catch(() => { /* тихо: плашка — не критичная поверхность, придёт со следующим тиком колокольчика */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const view = noticeView(notice, now);
  // Демо — витрина продукта, наши раскатки смотрящего не касаются (и полоса Demo mode вверху
  // уже занимает это место).
  if (!view || me?.is_demo) return null;

  const soon = view.phase === "soon";
  const custom = dt(notice?.ru ?? "", notice?.en ?? "");
  const head = custom
    || (soon
      ? dt(`Обновление через ${view.minutes} мин`, `Update in ${view.minutes} min`)
      : dt("Идёт обновление", "Updating now"));

  // Крестика нет (решение владельца 2026-09-25: «нельзя убрать уведомление, должно висеть и
  // напоминать»): плашка висит, пока не снимут кнопкой или не выйдет срок `until`. Свой текст
  // длинный — переносится на вторую строку, а не обрезается многоточием.
  // В ПОТОКЕ, а не `fixed`: плавающая пилюля накрывала заголовок экрана на мобилке (проверено
  // на 390px — «Задачи» читались из-под неё). Своя тонкая строка сдвигает контент один раз,
  // ровно как полоса Demo mode рядом, и ничего не закрывает.
  return (
    <div className="flex shrink-0 justify-center px-3 pt-2">
      <div
        role="status"
        aria-live="polite"
        className={`flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 font-semibold shadow-[0_4px_14px_rgba(27,32,40,0.10)] ${
          soon
            ? "border-accent-line bg-accent-soft text-accent-ink"
            : "border-transparent bg-primary text-primary-foreground"
        }`}
        // Перенесённый на две строки текст в пилюле выглядит обрубком — скругляем мягче.
        style={custom ? { fontSize: 12.5, borderRadius: 14 } : { fontSize: 12.5 }}
      >
        <RoyIcon name="clock" size={13} strokeWidth={2.1} />
        <span className={custom ? "min-w-0" : "truncate"}>{head}</span>
        {!custom && (
          <span className={`hidden truncate font-normal sm:inline ${soon ? "text-accent-ink/70" : "text-primary-foreground/80"}`}>
            · {dt("страница перезагрузится сама", "the page will reload itself")}
          </span>
        )}
      </div>
    </div>
  );
}
