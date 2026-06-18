"use client";
import { useRoyNav } from "../nav";
import { Avatar, TypeTag, TYPE_TAG } from "../ui";
import { RoyIcon } from "../icons";
import { entryTagKey, deriveEntryTitle } from "../entry";
import { DashBlock, Row, AccentBadge, relTime, initials } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Entry } from "@/types";

// Центр-низ главного экрана: лента «Добавлено за сутки» — записи базы за последние 24ч
// (recentEntries), от новых к старым. Строка: иконка типа записи, заголовок, лейбл типа,
// аватар автора (если имя есть — иначе без), относительное время. Тап → деталь записи.

// Имя автора показываем только если это человеческое имя (не сырой telegram_id и не пусто).
function authorName(e: Entry): string | null {
  const raw = e.added_by?.trim();
  if (!raw || /^\d+$/.test(raw)) return null;
  return raw;
}

function MaterialRow({ e, now, onOpen }: { e: Entry; now: number; onOpen: () => void }) {
  const tagKey = entryTagKey(e);
  const tag = TYPE_TAG[tagKey] ?? TYPE_TAG.doc;
  const author = authorName(e);
  return (
    <Row onClick={onOpen}>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: 30, height: 30, color: tag.color, background: `${tag.color}14`, border: `1px solid ${tag.color}26` }}
      >
        <RoyIcon name={tag.icon} size={15} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
          {deriveEntryTitle(e)}
        </div>
        <div className="mt-0.5">
          <TypeTag type={tagKey} small />
        </div>
      </div>
      {author && <Avatar size={22}>{initials(author)}</Avatar>}
      <span className="shrink-0 text-right font-medium text-ink-mute" style={{ fontSize: 11.5, width: 44 }}>
        {relTime(e.created_at, now)}
      </span>
    </Row>
  );
}

export function Materials({ data, className }: { data: DashboardData; className?: string }) {
  const { push, setTab } = useRoyNav();
  const { loading, materials } = data;
  const now = Date.now();

  return (
    <DashBlock
      title="Добавлено за сутки"
      icon="clock"
      tint="var(--accent-ink)"
      badge={materials.length > 0 ? <AccentBadge>{materials.length} новых</AccentBadge> : undefined}
      headAction="База"
      loading={loading}
      empty={materials.length === 0}
      emptyText="За последние сутки ничего не добавляли"
      onHead={() => setTab("book")}
      className={className}
    >
      {materials.map((e) => (
        <MaterialRow key={e.id} e={e} now={now} onOpen={() => push({ view: "record", params: { id: e.id } })} />
      ))}
    </DashBlock>
  );
}
