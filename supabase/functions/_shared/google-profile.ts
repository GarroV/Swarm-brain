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
// emailLocal — локальная часть почты: ею auth-resolve засевает first_name, если Google имени
// не дал. Это заглушка, а не ручной ввод, поэтому при следующем входе с именем её заменяем.
// Без этого заглушка («a.nuralieva») оставалась в фильтре сотрудников навсегда.
export function profileNameUpdate(
  existing: ProfileNames | null,
  n: GoogleName,
  emailLocal?: string | null,
): ProfileNames | null {
  const given = normalizeName(n.given);
  const family = normalizeName(n.family);
  const upd: ProfileNames = {};
  const first = normalizeName(existing?.first_name);
  const isPlaceholder = first != null && emailLocal != null &&
    first.toLowerCase() === emailLocal.trim().toLowerCase();
  if (given && (!first || isPlaceholder)) upd.first_name = given;
  if (family && !normalizeName(existing?.last_name)) upd.last_name = family;
  return Object.keys(upd).length > 0 ? upd : null;
}

// ── Аватарка из Google (userinfo.picture → user_profiles.avatar_url) ─────────
// Подписывается ОТДЕЛЬНЫМ полем avatar_sig поверх `sig`, а не входит в подпись имени: так любая
// пара версий Pages и auth-resolve при раскатке (она идёт в два места, не атомарно) продолжает
// пускать людей — старая функция лишних полей не читает, новая принимает и старую подпись без
// картинки. Префикс «avatar|» разводит домены: подпись email|given|family не годится как avatar_sig.
const MAX_AVATAR_URL_LEN = 500;
const AVATAR_HOST_SUFFIX = ".googleusercontent.com";

// Только https и хост *.googleusercontent.com, длина ≤ 500; всё остальное — null (игнор).
export function normalizeAvatarUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t || t.length > MAX_AVATAR_URL_LEN) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!u.hostname.toLowerCase().endsWith(AVATAR_HOST_SUFFIX)) return null;
  return t;
}

export function avatarSigPayload(email: string, picture: string | null | undefined): string {
  return `avatar|${email}|${normalizeAvatarUrl(picture) ?? ""}`;
}

function sameSig(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Картинка, которой можно верить: валидный URL И подпись avatar_sig, посчитанная владельцем
// WEB_JWT_SECRET над «avatar|email|url». Иначе null — вход идёт дальше без фото.
export async function verifiedAvatar(
  email: string,
  url: string | null | undefined,
  sig: string | null | undefined,
  hmacHex: (data: string) => Promise<string>,
): Promise<string | null> {
  const picture = normalizeAvatarUrl(url);
  if (!picture || !sig) return null;
  return sameSig(sig, await hmacHex(avatarSigPayload(email, picture))) ? picture : null;
}

// Что записать в user_profiles.avatar_url: фото не ручное поле, обновляем при каждом входе,
// если изменилось. null = писать нечего (нет валидной картинки или та же самая).
export function avatarUpdate(existing: string | null | undefined, picture: string | null | undefined): string | null {
  const next = normalizeAvatarUrl(picture);
  if (!next || next === existing) return null;
  return next;
}
