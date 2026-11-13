// Чипы рынков профиля: рынки пространства + выбранные, которых в пространстве нет (#1275).
// Без вторых их нельзя было бы снять: чип не рисовался, а сводка профиля продолжала их показывать.
export type MarketChip = { code: string; outside: boolean };

export function marketChips(allowed: string[], selected: string[]): MarketChip[] {
  const outside = selected.filter((c) => !allowed.includes(c));
  return [...allowed.map((code) => ({ code, outside: false })), ...outside.map((code) => ({ code, outside: true }))];
}

/** Подсказка чипа вне списка пространства: [ru, en]. */
export const OUTSIDE_MARKET_HINT: [string, string] = ["нет в рынках пространства", "not in workspace markets"];
