import type { MeetingLiveNote } from "@/types";
import { isRawId } from "./displayFormat";

// Пометки «на полях» → сгруппированы по автору, порядок авторов — по первому таймкоду
// (читается как хроника встречи, а не как перемешанный список). Одну встречу пишут несколько
// человек, и заметки собираются со ВСЕХ версий встречи: решение владельца 2026-08-28 —
// «заметки сохраняем все, с разбивкой по пользователям».
export function groupNotesByAuthor(live: MeetingLiveNote[]): Array<[string, MeetingLiveNote[]]> {
  const byAuthor = new Map<string, MeetingLiveNote[]>();
  for (const n of [...live].sort((a, b) => a.offset_sec - b.offset_sec)) {
    // Имя приходит с сервера (имя → @username → e-mail, #537). Без имени — «#id», чтобы
    // пометка не потеряла автора: «неизвестно кто» на командной встрече бесполезно. Голый номер
    // в имени (в т.ч. отрицательный у вошедших через Google) за имя не считаем.
    const name = n.author_name?.trim();
    const key = name && !isRawId(name) ? name : (n.author_id != null ? `#${n.author_id}` : "—");
    const arr = byAuthor.get(key);
    if (arr) arr.push(n);
    else byAuthor.set(key, [n]);
  }
  return [...byAuthor.entries()];
}
