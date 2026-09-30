// Выгрузка для смоуков, у которой сервер может измерить длину (meeting-ingest/audio-length.ts).
//
// Заявка другого человека на занятую встречу в meeting-claim ничего не перехватывает: право решает
// длина, которую meeting-ingest измерит в выгрузке сам — по содержимому части .m4a (таблица сэмплов
// звуковой дорожки и байты в mdat), а не по заголовку. Смоуку настоящий звук не нужен — поддельный
// Whisper его не слушает, — нужна форма файла, как у клиентов: её собирает m4a-fixture.ts.
import {
  m4aOf,
  type Overrides,
} from "../supabase/functions/meeting-ingest/m4a-fixture.ts";

/**
 * Форма meeting-ingest с одной системной дорожкой: части подряд по `partSeconds` (≤ 15 минут,
 * как режет рекордер), каждая со своим настоящим стартом.
 */
export function ingestFormOf(
  meetingId: string,
  totalSeconds: number,
  partSeconds = 900,
  overrides: Overrides = {},
): FormData {
  const form = new FormData();
  form.append("meeting_id", meetingId);
  const starts: number[] = [];
  for (let at = 0; at < totalSeconds; at += partSeconds) starts.push(at);
  const name = (i: number) => `part-${String(i).padStart(3, "0")}`;
  form.append(
    "sys_parts",
    JSON.stringify(starts.map((offset, i) => ({ name: name(i), offset }))),
  );
  starts.forEach((offset, i) => {
    const bytes = m4aOf(
      Math.min(partSeconds, totalSeconds - offset),
      overrides,
    );
    form.append(
      name(i),
      new File([bytes], `${name(i)}.m4a`, { type: "audio/m4a" }),
    );
  });
  return form;
}
