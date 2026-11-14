/**
 * Основание встречи для смоука оркестратора: пропуск от двойника сервера (T165).
 */
import type { InviteReference } from "./claim-request.ts";
import type { ContainerId, Orchestrator } from "./orchestrator.ts";
import type { Swarm } from "./smoke-orchestrator-types.ts";

/**
 * Основание встречи для прямого запуска `startForMeeting`: приглашение человека на двойнике
 * сервера и пропуск по нему, как выдал бы сервер при заборе (T165). Без пропуска контейнер не
 * поднимается, а общий токен в него не передаётся. Приглашение одноразовое — на каждый запуск своё.
 */
export function inviteBasis(fake: Swarm, person: number, joinUrl: string): InviteReference {
  const invite = fake.addInvite({ joinUrl, invitedBy: person });
  fake.acceptGrant(invite.grant_token);
  return { id: invite.id, joinUrl, grantToken: invite.grant_token };
}

export const CHILD_BASIS_ENV = "SCRIBA_SMOKE_CHILD_BASIS";

/**
 * Основание встречи дочернего процесса: пропуск и приглашение заводит родитель на своём двойнике
 * сервера и передаёт через окружение (у дочернего процесса двойника нет).
 */
export function childBasis(): InviteReference {
  const raw = process.env[CHILD_BASIS_ENV];
  if (raw === undefined || raw === "") throw new Error(`${CHILD_BASIS_ENV} не передан`);
  return JSON.parse(raw) as InviteReference;
}

/**
 * Запустить встречу с пропуском от двойника сервера (одно приглашение на запуск).
 */
export async function startInvited(
  orchestrator: Orchestrator,
  fake: Swarm,
  person: number,
  joinUrl: string,
): Promise<ContainerId> {
  return orchestrator.startForMeeting(joinUrl, "meet", person, inviteBasis(fake, person, joinUrl));
}
