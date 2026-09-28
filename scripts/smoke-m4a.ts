// Выгрузка для смоуков, у которой сервер может измерить длину (meeting-ingest/audio-length.ts).
//
// Заявка другого человека на занятую встречу в meeting-claim ничего не перехватывает: право решает
// длина, которую meeting-ingest измерит в выгрузке сам (заголовок moov/mvhd части .m4a). Смоуку
// настоящий звук не нужен — поддельный Whisper его не слушает, — нужен заголовок с длительностью.
// Поэтому часть собирается из боксов ftyp + moov/mvhd + mdat: столько секунд, сколько попросили,
// без ffmpeg и без мегабайт в памяти.

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Часть .m4a длиной `seconds` по заголовку (mvhd версии 0, шкала 1000). */
export function fakeM4a(seconds: number): Uint8Array<ArrayBuffer> {
  const mvhd = new Uint8Array(100);
  const dv = new DataView(mvhd.buffer);
  dv.setUint32(12, 1000);
  dv.setUint32(16, Math.round(seconds * 1000));
  return concat(
    box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A isom")),
    box("mdat", new Uint8Array(2048)),
    box("moov", box("mvhd", mvhd)),
  );
}

/**
 * Форма meeting-ingest с одной системной дорожкой: части подряд по `partSeconds` (≤ 15 минут,
 * как режет рекордер), каждая со своим настоящим стартом.
 */
export function ingestFormOf(meetingId: string, totalSeconds: number, partSeconds = 900): FormData {
  const form = new FormData();
  form.append("meeting_id", meetingId);
  const starts: number[] = [];
  for (let at = 0; at < totalSeconds; at += partSeconds) starts.push(at);
  const name = (i: number) => `part-${String(i).padStart(3, "0")}`;
  form.append("sys_parts", JSON.stringify(starts.map((offset, i) => ({ name: name(i), offset }))));
  starts.forEach((offset, i) => {
    const bytes = fakeM4a(Math.min(partSeconds, totalSeconds - offset));
    form.append(name(i), new File([bytes], `${name(i)}.m4a`, { type: "audio/m4a" }));
  });
  return form;
}
