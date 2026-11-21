import type { startFakeSwarm } from "../swarm-client/testing/fake-swarm.ts";
import type { NoticeProxy } from "./smoke-notices.ts";

export type Swarm = Awaited<ReturnType<typeof startFakeSwarm>>;

/**
 * Двойник сервера целиком: `fake-swarm` за прокси, который сам отвечает на `/meeting-notice`.
 */
export type Fake = Swarm & { readonly noticeProxy: NoticeProxy };

export interface Beat {
  readonly recording: boolean;
}

// ──── ручной запуск по приглашению (D017): настоящая служба orchestrator-main.ts дочерним процессом

export interface Service {
  readonly lines: string[];
  stop(): Promise<void>;
}
