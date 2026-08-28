// Имя человека из Google-логина → user_profiles.
//
// Вход через Google уже просит scope `profile` (miniapp/functions/api/auth/google/start.ts),
// то есть userinfo отдаёт given_name/family_name при КАЖДОМ входе. До 28.08.2026 callback читал
// только email и имя выбрасывал, а user_profiles.first_name не заполнял никто — он был забит
// вручную у 12 из 14 человек. Имя нужно как источник дефолтного названия записи без календаря
// (docs/decisions/2026-08-28-status-bar-on-air.md, п.4).
//
// Решения, зашитые здесь:
//   • имя ВХОДИТ в подписываемую строку — иначе владелец валидной подписи email мог бы подменить
//     чужое имя реплеем запроса к auth-resolve;
//   • вручную заполненное поле НЕ перетирается, даже если Google знает «правильнее»;
//   • пустая строка и пробелы считаются пустотой (в базе встречается и NULL, и "").

// user_profiles.first_name/last_name — text без ограничения, но незачем принимать килобайт из
// внешнего ответа: 120 символов перекрывают любое реальное имя.
const MAX_NAME_LEN = 120;

export type GoogleName = { given?: string | null; family?: string | null };
export type ProfileNames = { first_name?: string | null; last_name?: string | null };

export function normalizeName(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.slice(0, MAX_NAME_LEN);
}

// Канон строки под HMAC: email|given|family. Пустые части дают пустое место, а не "undefined",
// иначе подпись на стороне CF Pages и проверка здесь разъедутся на людях без фамилии в Google.
export function nameSigPayload(email: string, n: GoogleName): string {
  return `${email}|${normalizeName(n.given) ?? ""}|${normalizeName(n.family) ?? ""}`;
}

// Что дописать в user_profiles: только пустые поля, только если Google реально дал значение.
// null = писать нечего (не делаем лишний UPDATE на каждый вход).
export function profileNameUpdate(existing: ProfileNames | null, n: GoogleName): ProfileNames | null {
  const given = normalizeName(n.given);
  const family = normalizeName(n.family);
  const upd: ProfileNames = {};
  if (given && !normalizeName(existing?.first_name)) upd.first_name = given;
  if (family && !normalizeName(existing?.last_name)) upd.last_name = family;
  return Object.keys(upd).length > 0 ? upd : null;
}
