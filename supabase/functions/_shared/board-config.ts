// Размеры доски «Сегодня» в рекордере читаются с сервера: правка `app_settings.recorder_board`
// применяется у всех без новой сборки (docs/decisions/2026-10-22-bumblebee-hub.md, п. 5).
// Строки в app_settings нет — дефолты. Неверное значение поля — дефолт ЭТОГО поля, остальные живут.

export type RecorderBoardConfig = {
  task_rows: number;
  panel_width: number;
  meetings_width: number;
  notes_height: number;
  refresh_seconds: number;
};

export const RECORDER_BOARD_KEY = "recorder_board";

export const DEFAULT_BOARD_CONFIG: RecorderBoardConfig = {
  task_rows: 10,
  panel_width: 720,
  meetings_width: 240,
  notes_height: 260,
  refresh_seconds: 60,
};

/** Разумные пределы по полям: вне них значение считается чужим и игнорируется. */
const LIMITS: Record<keyof RecorderBoardConfig, readonly [number, number]> = {
  task_rows: [1, 50],
  panel_width: [320, 2000],
  meetings_width: [120, 800],
  notes_height: [80, 1200],
  refresh_seconds: [10, 3600],
};

/** Значение `app_settings.recorder_board` (jsonb, любой формы) → конфиг с дефолтами. */
export function parseBoardConfig(raw: unknown): RecorderBoardConfig {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_BOARD_CONFIG };
  for (const key of Object.keys(LIMITS) as Array<keyof RecorderBoardConfig>) {
    const v = src[key];
    const [min, max] = LIMITS[key];
    if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) out[key] = v;
  }
  return out;
}
