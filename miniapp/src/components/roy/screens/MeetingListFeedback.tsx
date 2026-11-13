"use client";
import { useDt } from "../nav";
import { MEET_DETAIL_COPY } from "./meetAdminPresentation";

export function MeetingListFeedback({ failed, hasMore, loadingMore, onRetry, onMore }: {
  failed: boolean; hasMore: boolean; loadingMore: boolean; onRetry: () => void; onMore: () => void;
}) {
  const dt = useDt();
  if (failed) return <div role="alert" className="py-3 text-center text-sm text-ink-soft">
    <p>{dt(MEET_DETAIL_COPY.listFailed.ru, MEET_DETAIL_COPY.listFailed.en)}</p>
    <button type="button" className="mt-1 underline" onClick={onRetry}>{dt(MEET_DETAIL_COPY.retry.ru, MEET_DETAIL_COPY.retry.en)}</button>
  </div>;
  if (!hasMore) return null;
  return <button type="button" onClick={onMore} disabled={loadingMore}
    className="w-full py-3 text-sm font-semibold text-ink-soft disabled:opacity-60">
    {loadingMore ? dt(MEET_DETAIL_COPY.loadingMore.ru, MEET_DETAIL_COPY.loadingMore.en) : dt(MEET_DETAIL_COPY.showMore.ru, MEET_DETAIL_COPY.showMore.en)}
  </button>;
}
