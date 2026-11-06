/**
 * Вердикт пробного захода в Meet под аккаунтом бота (#1140). Чистая функция: страницу читает
 * `probe-main.ts`, правило «вошли или слетел» то же, что у двери встречи (`admission.ts`).
 *
 * Результат — исход для строки состояния и для оркестратора:
 *  - `account_signin_required` — Google просит вход: вход слетел;
 *  - `probe_ok` — открылась страница Meet и вход не отвергнут;
 *  - `probe_inconclusive` — страница не Meet (ошибка сети, заглушка): про вход ничего не сказать,
 *    а значит и тревогу, и «всё хорошо» объявлять нельзя.
 */
import { classifyAdmission } from "../meet-adapter/admission.ts";
import type { MeetSnapshot } from "../meet-adapter/types.ts";

type ProbeOutcome = "probe_ok" | "account_signin_required" | "probe_inconclusive";

export interface ProbeVerdict {
  readonly outcome: ProbeOutcome;
  readonly reason: string;
}

const MEET_HOST = "meet.google.com";

export function probeVerdict(snapshot: MeetSnapshot): ProbeVerdict {
  const verdict = classifyAdmission(snapshot, { isSignedIn: true });
  if (verdict.state === "signin_required") {
    return { outcome: "account_signin_required", reason: verdict.reason };
  }
  if (snapshot.host !== MEET_HOST) {
    return {
      outcome: "probe_inconclusive",
      reason: `открылась не страница Meet, а ${snapshot.host || "пустая страница"}`,
    };
  }
  return { outcome: "probe_ok", reason: "Meet открылся без просьбы войти" };
}
