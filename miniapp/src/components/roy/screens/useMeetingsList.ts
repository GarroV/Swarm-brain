"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "@/types";
import { fetchMeetingsPage } from "@/lib/api";
import {
  firstCursor, mergeById, nextCursor, pageQuery, type PagingCursor,
} from "@/lib/meetingsPaging";
import { userBoundsOf, type MeetingsFilterState } from "./meetingsFilter";

// Список встреч с подгрузкой частями (решение владельца 2026-10-13, порядок и схема фаз —
// lib/meetingsPaging.ts). Сразу: очередь вычитки + встречи за вчера и сегодня; остальное — по
// кнопке «Показать ещё». Поиск, период и «Общее/Личное» уходят на сервер; страны, источник и
// «кто принёс» применяет экран к загруженному — пока такой фильтр включён, остаток подгружается
// сам (needAll), чтобы результат был полным.

const SEARCH_DEBOUNCE_MS = 250;
const PENDING_LIMIT = 200;

export type MeetingsList = {
  /** Очередь вычитки (лёгкие строки); пусто, если хук вызван без `pending`. */
  pending: Entry[];
  /** Согласованные встречи, загруженные на сейчас. */
  confirmed: Entry[];
  loading: boolean;
  failed: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** Согласованных встреч всего (без фильтров экрана); null — сервер не сказал. */
  unfilteredTotal: number | null;
  /** Заменить/убрать/добавить строку после мутации на экране. */
  update: (id: string, fn: (e: Entry) => Entry) => void;
  remove: (id: string) => void;
  upsert: (e: Entry) => void;
};

export function useMeetingsList(
  f: MeetingsFilterState,
  opts: { reloadKey?: unknown; pending?: boolean; needAll?: boolean; skipConfirmed?: boolean } = {},
): MeetingsList {
  const { reloadKey, pending: withPending = true, needAll = false, skipConfirmed = false } = opts;

  // Поиск — с задержкой: на каждую букву запрос к серверу не нужен.
  const [q, setQ] = useState(f.query.trim());
  useEffect(() => {
    const t = setTimeout(() => setQ(f.query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [f.query]);

  const bounds = useMemo(() => userBoundsOf(f), [f.period, f.from, f.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtersKey = JSON.stringify([q, f.storage, bounds, reloadKey, skipConfirmed]);

  const [pending, setPending] = useState<Entry[]>([]);
  const [confirmed, setConfirmed] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<PagingCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unfilteredTotal, setUnfilteredTotal] = useState<number | null>(null);
  // Номер текущей выборки: ответ от устаревшей (фильтр уже сменился) выбрасывается.
  const gen = useRef(0);
  // Скелет — только до первого ответа; при смене фильтра старый список остаётся на экране,
  // пока едет новый (иначе таблица мигала бы на каждую букву поиска).
  const loadedOnce = useRef(false);

  // Очередь вычитки — не зависит от фильтров, перечитывается только по reloadKey.
  useEffect(() => {
    if (!withPending) return;
    let live = true;
    fetchMeetingsPage({ confirmed: false, limit: PENDING_LIMIT })
      .then((p) => { if (live) setPending(p.rows); })
      .catch((e) => console.warn("[useMeetingsList] pending", e));
    return () => { live = false; };
  }, [withPending, reloadKey]);

  useEffect(() => {
    const my = ++gen.current;
    if (skipConfirmed) {
      setConfirmed([]); setCursor(null); setLoading(false); setFailed(false);
      return;
    }
    if (!loadedOnce.current) setLoading(true);
    setFailed(false);
    const start = firstCursor(bounds);
    fetchMeetingsPage(pageQuery(start, { q, storage: f.storage }, bounds))
      .then((p) => {
        if (gen.current !== my) return;
        setConfirmed(mergeById([], p.rows));
        setCursor(nextCursor(start, { rows: p.rows.length, total: p.total }));
        setUnfilteredTotal(p.unfilteredTotal);
        loadedOnce.current = true;
        setLoading(false);
      })
      .catch((e) => {
        if (gen.current !== my) return;
        console.error("[useMeetingsList] confirmed", e);
        setConfirmed([]); setCursor(null); setFailed(true); setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const loadMore = useCallback(() => {
    if (!cursor || loading || loadingMore) return;
    const my = gen.current;
    const at = cursor;
    setLoadingMore(true);
    fetchMeetingsPage(pageQuery(at, { q, storage: f.storage }, bounds))
      .then((p) => {
        if (gen.current !== my) return;
        setConfirmed((prev) => mergeById(prev, p.rows));
        setCursor(nextCursor(at, { rows: p.rows.length, total: p.total }));
        setLoadingMore(false);
      })
      .catch((e) => {
        if (gen.current !== my) return;
        console.error("[useMeetingsList] more", e);
        setFailed(true); setLoadingMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loading, loadingMore, filtersKey]);

  // Фильтр, который сервер не умеет, включён — докачиваем остаток, чтобы показать полный результат.
  // После сбоя не повторяем: failed останавливает цикл.
  useEffect(() => {
    if (needAll && cursor && !loading && !loadingMore && !failed) loadMore();
  }, [needAll, cursor, loading, loadingMore, failed, loadMore]);

  const update = useCallback((id: string, fn: (e: Entry) => Entry) => {
    setConfirmed((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));
    setPending((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));
  }, []);
  const remove = useCallback((id: string) => {
    setConfirmed((prev) => prev.filter((e) => e.id !== id));
    setPending((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const upsert = useCallback((e: Entry) => {
    setConfirmed((prev) => (prev.some((x) => x.id === e.id) ? prev.map((x) => (x.id === e.id ? e : x)) : [e, ...prev]));
  }, []);

  return { pending, confirmed, loading, failed, hasMore: cursor !== null, loadingMore, loadMore, unfilteredTotal, update, remove, upsert };
}
