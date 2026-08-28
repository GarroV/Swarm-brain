import type { MeetingLiveNote } from "@/types";

// Пометки «на полях» → сгруппированы по автору, порядок авторов — по первому таймкоду
// (читается как хроника встречи, а не как перемешанный список). Одну встречу пишут несколько
// человек, и заметки собираются со ВСЕХ версий встречи: решение владельца 2026-08-28 —
// «заметки сохраняем все, с разбивкой по пользователям».
export function groupNotesByAuthor(live: MeetingLiveNote[]): Array<[string, MeetingLiveNote[]]> {
  const byAuthor = new Map<string, MeetingLiveNote[]>();
  for (const n of [...live].sort((a, b) => a.offset_sec - b.offset_sec)) {
    // Имя приходит с сервера (резолв author_id → user_profiles). Без имени — «#id», чтобы
    // пометка не потеряла автора: «неизвестно кто» на командной встрече бесполезно.
    const key = n.author_name?.trim() || (n.author_id != null ? `#${n.author_id}` : "—");
    const arr = byAuthor.get(key);
    if (arr) arr.push(n);
    else byAuthor.set(key, [n]);
  }
  return [...byAuthor.entries()];
}
