/**
 * Сборка входа «ручной запуск» из живых частей: клиент `meeting-invite`, оркестратор,
 * заявка и нотиса от имени позвавшего. Правила — в `invite-trigger.ts`; здесь только провода,
 * общие для службы (`orchestrator-main.ts`) и смоука.
 */
import { randomUUID } from "node:crypto";

import { SwarmClient } from "../swarm-client/client.ts";
import type { ClaimRequest, ClaimResponse, MeetingInvite } from "../swarm-client/contract.ts";
import { InviteClient } from "../swarm-client/invites.ts";
import { type InviteReference, manualClaim } from "./claim-request.ts";
import { InviteTrigger } from "./invite-trigger.ts";
import type { Notifier } from "./notices.ts";

interface RefusalDependencies {
  readonly claim: (request: ClaimRequest) => Promise<ClaimResponse>;
  readonly notifier: Notifier;
  readonly version: number;
  readonly runId: string;
  readonly startedAt: string;
}

/**
 * Сказать позвавшему, что бот не придёт. Нотисе `join_failed` нужна строка встречи, а её
 * заводит только `meeting-claim` — поэтому оркестратор сперва заявляет встречу по тому же
 * приглашению (сервер его сверит и погасит), затем шлёт отказ с причиной. Цена — пустая
 * ручная встреча на сервере, как у бота, которого не впустили; тишина стоила бы дороже.
 */
async function refuseInvite(
  dependencies: RefusalDependencies,
  invite: MeetingInvite,
  detail: string,
): Promise<void> {
  const claimed = await dependencies.claim(
    manualClaim({
      runId: dependencies.runId,
      version: dependencies.version,
      startedAt: dependencies.startedAt,
      invite: { id: invite.id, joinUrl: invite.join_url },
    }),
  );
  await dependencies.notifier.notify({
    kind: "join_failed",
    meetingId: claimed.meeting_id,
    detail,
  });
}

export interface InviteServiceOptions {
  /**
   * Корень функций Swarm, каким его видит сам оркестратор.
   */
  readonly swarmUrl: string;
  readonly token: string;
  readonly version: number;
  readonly startForMeeting: (
    joinUrl: string,
    platform: string,
    onBehalfOf: number,
    invite: InviteReference,
  ) => Promise<string>;
  readonly notifierFor: (onBehalfOf: number) => Notifier;
  readonly log: (line: string) => void;
  readonly intervalMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export function inviteTriggerFor(options: InviteServiceOptions): InviteTrigger {
  const invites = new InviteClient({
    baseUrl: options.swarmUrl,
    token: options.token,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
  return new InviteTrigger({
    take: async () => invites.take(),
    start: async (invite) =>
      options.startForMeeting(invite.join_url, invite.platform, invite.invited_by, {
        id: invite.id,
        joinUrl: invite.join_url,
      }),
    refuse: async (invite, detail) => {
      const client = new SwarmClient({
        baseUrl: options.swarmUrl,
        token: options.token,
        onBehalfOf: invite.invited_by,
        ...(options.fetch !== undefined && { fetch: options.fetch }),
      });
      await refuseInvite(
        {
          claim: async (request) => client.claim(request),
          notifier: options.notifierFor(invite.invited_by),
          version: options.version,
          runId: randomUUID(),
          startedAt: new Date().toISOString(),
        },
        invite,
        detail,
      );
    },
    log: options.log,
    ...(options.intervalMs !== undefined && { intervalMs: options.intervalMs }),
  });
}
