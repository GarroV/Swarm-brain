/**
 * Тело `meeting-claim` для ручной встречи бота — одно на процесс встречи в контейнере и на
 * отказ оркестратора (площадка без адаптера), чтобы оба заявлялись одинаково.
 *
 * Ключ `scriba:<runId>`: каждая ручная встреча своя, арбитража с календарной нет (решение
 * D006 — бок о бок с bumblebee). Приглашение (решение D017) — единственное, что пускает
 * служебного агента в ручную встречу: без него сервер отвечает 403.
 */
import type { ClaimRequest } from "../swarm-client/contract.ts";

export interface InviteReference {
  readonly id: string;
  /**
   * Ссылка на звонок; сервер сверяет её комнату с комнатой приглашения.
   */
  readonly joinUrl: string;
}

export function manualClaim(input: {
  readonly runId: string;
  readonly version: number;
  readonly startedAt: string;
  readonly invite: InviteReference | null;
}): ClaimRequest {
  return {
    identity_kind: "manual",
    identity_key: `scriba:${input.runId}`,
    started_at: input.startedAt,
    agent_version: `scriba-${String(input.version)}`,
    recorded_seconds: 0,
    ...(input.invite !== null && {
      invite_id: input.invite.id,
      join_url: input.invite.joinUrl,
    }),
  };
}
