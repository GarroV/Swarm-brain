// Фото людей из Google без нового входа (21.10.2026).
//
// До этого `user_profiles.avatar_url` заполнялся только при свежем входе через Google
// (auth-resolve → avatarUpdate), и на проде не было ни одной аватарки: люди сидят на старых
// сессиях. Но у тех, кто подключил календарь, лежит refresh-токен Google, выданный с scope
// `profile` (LOGIN_SCOPES, _shared/google-scopes.ts), — им можно спросить userinfo сразу.
//
// Решения, зашитые здесь:
//   • токен меняем тем же accessToken, что у календаря (кэш и разбор отказов общие), второго клиента нет;
//   • адрес проходит тот же normalizeAvatarUrl, что и при входе: только https *.googleusercontent.com;
//   • пишем только если изменилось (avatarUpdate);
//   • нет scope у старого токена, мёртвый токен, сбой Google — тихий пропуск этого человека, а не
//     ошибка системы; сбой одного не останавливает остальных; токены в лог не попадают.
import { GOOGLE_TIMEOUT_MS, type TokenResult } from "./google-calendar.ts";
import { externalFetch } from "./external-fetch.ts";
import { avatarUpdate, normalizeAvatarUrl } from "./google-profile.ts";

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Фото из тела ответа userinfo; всё, что не похоже на фото Google, — null. */
export function pictureFromUserinfo(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const picture = (body as { picture?: unknown }).picture;
  return typeof picture === "string" ? normalizeAvatarUrl(picture) : null;
}

export type PictureResult =
  | { ok: true; picture: string | null }
  /** `status` — код Google (401/403: у токена нет scope profile); null — Google не ответил. */
  | { ok: false; status: number | null };

export async function fetchGooglePicture(token: string, timeoutMs = GOOGLE_TIMEOUT_MS): Promise<PictureResult> {
  let res: Response;
  try {
    res = await externalFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } }, {
      service: "google-userinfo",
      timeoutMs,
      attempts: 1,
    });
  } catch {
    return { ok: false, status: null };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, status: res.status };
  }
  try {
    return { ok: true, picture: pictureFromUserinfo(await res.json()) };
  } catch {
    return { ok: false, status: null };
  }
}

export interface AvatarPerson {
  telegramId: number;
  refreshToken: string;
  /** Что лежит в user_profiles.avatar_url сейчас. */
  current: string | null;
}

export interface AvatarDeps {
  /** Люди с подключённым календарём и их нынешнее фото. */
  people(): Promise<AvatarPerson[]>;
  accessToken(refresh: string): Promise<TokenResult>;
  fetchPicture(token: string): Promise<PictureResult>;
  save(telegramId: number, avatarUrl: string): Promise<void>;
  log(line: string): void;
}

export interface AvatarReport {
  people: number;
  updated: number;
  unchanged: number;
  /** Токен мёртв, нет scope profile или Google не ответил — не ошибка системы. */
  skipped: number;
  /** Сбой записи в базу. */
  failed: number;
}

export async function syncAvatars(deps: AvatarDeps): Promise<AvatarReport> {
  const people = await deps.people();
  const report: AvatarReport = { people: people.length, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const p of people) {
    try {
      const tok = await deps.accessToken(p.refreshToken);
      if (!tok.ok) {
        report.skipped += 1;
        continue;
      }
      const got = await deps.fetchPicture(tok.token);
      if (!got.ok) {
        report.skipped += 1;
        continue;
      }
      const next = avatarUpdate(p.current, got.picture);
      if (next === null) {
        report.unchanged += 1;
        continue;
      }
      await deps.save(p.telegramId, next);
      report.updated += 1;
    } catch (e) {
      report.failed += 1;
      deps.log(`google-avatars: ${p.telegramId} — сбой: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
