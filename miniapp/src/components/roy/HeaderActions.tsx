"use client";
import { NotificationsBell } from "./NotificationsBell";
import { SearchBtn } from "./ui";
import { useRoyNav } from "./nav";

// Правый угол шапки мобильных корневых экранов: колокольчик + поиск.
// Оба контрола раньше жили в шапке «Поиска» — единственного экрана, который был домом. После
// редизайна навигации (2026-08-22) дом — «Задачи», а «Поиск» стал push-экраном, поэтому оба
// уехали бы вглубь: уведомления надо видеть с любого таба, искать — тоже.
export function HeaderActions() {
  const { push } = useRoyNav();
  return (
    <div className="flex items-center gap-1.5">
      <NotificationsBell />
      <SearchBtn onClick={() => push({ view: "ask" })} />
    </div>
  );
}
