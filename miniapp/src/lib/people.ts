// Как человек выглядит в плотном списке: две буквы и цвет вместо полного имени.
//
// Отдельным модулем, а не внутри компонента: правило одно на все экраны, и разъехавшись,
// оно даёт разные инициалы одному человеку в списке и в шапке — читается как два разных
// человека.

/**
 * Инициалы: по первой букве имени и фамилии, у односложного имени — две первые буквы.
 * Пустое имя даёт «?» — тот же знак, что у задачи без исполнителя: «неизвестно кто».
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return [...parts[0]].slice(0, 2).join("").toUpperCase();
  }
  return ([...parts[0]][0] + [...parts[1]][0]).toUpperCase();
}

/** Палитра кружка. Тона берутся из темы — свои цвета здесь развалили бы тёмную. */
export const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-status-done/15 text-status-done",
  "bg-pri-med/15 text-pri-med",
  "bg-pri-high/15 text-pri-high",
  "bg-ink/10 text-ink",
] as const;

/**
 * Цвет кружка считается от имени, а не назначается: человек узнаёт свои задачи по пятну
 * раньше, чем читает буквы, и одинаковый серый у всех эту подсказку убивает. Один и тот же
 * человек обязан получать один и тот же тон на всех экранах — отсюда чистая функция.
 */
export function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
