"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "@/types";
import { fetchMeetingsPage } from "@/lib/api";
import { loadPendingMeetingPages } from "@/lib/meetingsPageRequest";
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

export type MeetingsList = {
  /** Очередь вычитки (лёгкие строки); пусто, если хук вызван без `pending`. */
  pending: Entry[];
  /** Согласованные встречи, загруженные на сейчас. */
  confirmed: Entry[];
  loading: boolean;
  failed: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  loadMore: () => void;
  retry: () => void;
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
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((n) => n + 1), []);
  const filtersKey = JSON.stringify([retryKey,q, f.storage, bounds, reloadKey, skipConfirmed]);
  const [loadedFilterKey, setLoadedFilterKey] = useState<string | null>(null);
  const refreshing = !skipConfirmed && (loadedFilterKey !== filtersKey || q !== f.query.trim());

  const [pending, setPending] = useState<Entry[]>([]);
  const [pendingFailed, setPendingFailed] = useState(false);
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
    loadPendingMeetingPages(fetchMeetingsPage, () => live)
      .then((rows) => { if (live) { setPending(rows); setPendingFailed(false); } })
      .catch((e) => { if (live) { console.warn("[useMeetingsList] pending", e); setPendingFailed(true); } });
    return () => { live = false; };
  }, [withPending, reloadKey, retryKey]);

  useEffect(() => {
    const my = ++gen.current;
    setLoadingMore(false);
    if (skipConfirmed) {
      setConfirmed([]); setCursor(null); setLoading(false); setFailed(false); setLoadedFilterKey(null);
      return;
    }
    if (!loadedOnce.current) setLoading(true);
    setFailed(false);
    const start = firstCursor(bounds);
    fetchMeetingsPage(pageQuery(start, { q, storage: f.storage }, bounds))
      .then((p) => {
        if (gen.current !== my) return;
        setConfirmed(mergeById([], p.rows));
        setCursor(nextCursor(start, { rows: p.rows.length, total: p.total, ...(p.keyset ? { lastRow: p.rows.at(-1) } : {}) }));
        setUnfilteredTotal(p.unfilteredTotal);
        loadedOnce.current = true;
        setLoadedFilterKey(filtersKey);
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
    if (!cursor || refreshing || loading || loadingMore) return;
    const my = gen.current;
    const at = cursor;
    setLoadingMore(true);
    setFailed(false);
    fetchMeetingsPage(pageQuery(at, { q, storage: f.storage }, bounds))
      .then((p) => {
        if (gen.current !== my) return;
        setConfirmed((prev) => mergeById(prev, p.rows));
        setCursor(nextCursor(at, { rows: p.rows.length, total: p.total, ...(p.keyset ? { lastRow: p.rows.at(-1) } : {}) }));
        setLoadingMore(false);
      })
      .catch((e) => {
        if (gen.current !== my) return;
        console.error("[useMeetingsList] more", e);
        setFailed(true); setLoadingMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, refreshing, loading, loadingMore, filtersKey]);

  // Фильтр, который сервер не умеет, включён — докачиваем остаток, чтобы показать полный результат.
  // После сбоя не повторяем: failed останавливает цикл.
  useEffect(() => {
    if ((needAll || cursor?.phase === "recent") && cursor && !refreshing && !loading && !loadingMore && !failed) loadMore();
  }, [needAll, cursor, refreshing, loading, loadingMore, failed, loadMore]);

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

  return { pending, confirmed, loading, failed: failed || (withPending && pendingFailed), hasMore: cursor !== null, loadingMore, refreshing, loadMore, retry, unfilteredTotal, update, remove, upsert };
}
