import type { SupportedPlatform } from "./config.ts";

// eslint-disable-next-line sonarjs/redundant-type-aliases -- имя из контракта блока (docs/furca/blocks/orchestrator.md)
export type ContainerId = string;

/**
Куда и на какой площадке идёт контейнер встречи: ссылка уже проверена адаптером площадки.
*/
export interface MeetingTarget {
  readonly joinUrl: string;
  readonly platform: SupportedPlatform;
}

export interface ManagedMeeting {
  readonly id: ContainerId;
  readonly runId: string;
  readonly onBehalfOf: number;
  readonly meetingId: string | null;
}

export type ContainerExit =
  | { readonly kind: "finished"; readonly outcome: string | null }
  | { readonly kind: "died"; readonly exitCode: number | null; readonly meetingId: string | null };
