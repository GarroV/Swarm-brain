// Подпись «записали» на карточке встречи (#1070 п.5). `recorders` хранит всех, кто заявлялся, — и
// бота, которого не пустили в звонок и заменили (role superseded, 0 с). Записавшим считается тот,
// кто держит право транскрибации или записал секунды; остальные в имена не попадают.

interface RecorderLike {
  telegram_id?: unknown;
  role?: unknown;
  recorded_seconds?: unknown;
}

/** telegram_id записавших по порядку списка. */
export function creditedRecorderIds(recorders: unknown): number[] {
  if (!Array.isArray(recorders)) return [];
  const ids: number[] = [];
  for (const r of recorders as Array<RecorderLike | null>) {
    if (typeof r?.telegram_id !== "number") continue;
    const seconds = typeof r.recorded_seconds === "number" ? r.recorded_seconds : 0;
    if (r.role === "transcribe" || seconds > 0) ids.push(r.telegram_id);
  }
  return ids;
}
