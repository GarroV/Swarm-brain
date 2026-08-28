// Дефолтное название записи, у которой нет своего.
//
// Запись без календаря (ручной старт, звонок из браузера с нераспознанным заголовком) раньше
// уезжала в базу как «Запись 28.08.2026, 15:30» — заглушку придумывал сам рекордер. В очереди
// вычитки такие строки не отличить: у пяти записей за день один префикс и разница в минутах.
//
// Решение владельца 2026-08-28 (docs/decisions/2026-08-28-status-bar-on-air.md, п.4):
// дефолт = «участник — дата», человек потом правит вручную (PATCH /agent-meetings/:id).
// Ставится на СЕРВЕРЕ: имя знает он (allowed_users/user_profiles), а не клиент, у которого на
// диске только токен. Заодно один дефолт вместо трёх клиентских заглушек.

// Команда живёт в Белграде — дата в названии должна совпадать с тем, что человек помнит.
const TITLE_TZ = "Europe/Belgrade";
// Имя в заголовке — подпись, а не сочинение: обрезаем, чтобы дата осталась видна в списке.
const MAX_NAME_LEN = 40;
const NO_NAME = "Запись";

export type NameSource = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
};

function clean(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t ? t : null;
}

// Как человека назвать в заголовке: имя из профиля → username → никак.
export function displayNameOf(src: NameSource): string | null {
  const first = clean(src.first_name);
  const last = clean(src.last_name);
  if (first) return last ? `${first} ${last}` : first;
  return clean(src.username);
}

export function defaultMeetingTitle(
  name: string | null | undefined,
  startedAtISO: string | null | undefined,
  now: Date = new Date(),
): string {
  const parsed = startedAtISO ? new Date(startedAtISO) : null;
  const when = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  const stamp = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TITLE_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(when);
  const who = (clean(name) ?? NO_NAME).slice(0, MAX_NAME_LEN);
  return `${who} — ${stamp}`;
}
