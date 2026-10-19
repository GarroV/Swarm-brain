// Хранилище в памяти для тестов ядра: та же семантика, что у supabaseStore (снятие вызова один
// раз, сравнение счётчика, вытеснение прежних вызовов), без базы.
import type {
  ChallengePurpose,
  DeviceLinkLimits,
  NewPasskey,
  PasskeyInfo,
  PasskeyStore,
  StoredPasskey,
} from "./store.ts";

type DeviceLink = {
  telegramId: number;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  challenge: string | null;
  challengeExpiresAt: number;
};

type Challenge = {
  telegramId: number;
  purpose: ChallengePurpose;
  challenge: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

export class MemoryStore implements PasskeyStore {
  keys: StoredPasskey[] = [];
  challenges: Challenge[] = [];
  links: DeviceLink[] = [];
  /** Название и даты ключа (у ключей, заведённых тестом напрямую в `keys`, их нет). */
  meta = new Map<string, { name: string; createdAt: number; lastUsedAt: number | null }>();

  constructor(private readonly clock: () => number = Date.now) {}

  listForPerson(telegramId: number) {
    return Promise.resolve(this.keys.filter((k) => k.telegramId === telegramId));
  }
  countChallengesSince(telegramId: number, sinceMs: number) {
    return Promise.resolve(this.challenges.filter((c) => c.telegramId === telegramId && c.createdAt >= sinceMs).length);
  }
  putChallenge(telegramId: number, purpose: ChallengePurpose, challenge: string, expiresAtMs: number) {
    for (const c of this.challenges) if (c.telegramId === telegramId) c.used = true;
    this.challenges.push({
      telegramId,
      purpose,
      challenge,
      createdAt: this.clock(),
      expiresAt: expiresAtMs,
      used: false,
    });
    return Promise.resolve();
  }
  takeChallenge(telegramId: number, nowMs: number) {
    const c = this.challenges.find((x) => x.telegramId === telegramId && !x.used && x.expiresAt > nowMs);
    if (!c) return Promise.resolve(null);
    c.used = true;
    return Promise.resolve({ purpose: c.purpose, challenge: c.challenge });
  }
  findByCredential(credentialId: string) {
    return Promise.resolve(this.keys.find((k) => k.credentialId === credentialId) ?? null);
  }
  insertPasskey(key: NewPasskey) {
    if (this.keys.some((k) => k.credentialId === key.credentialId)) return Promise.resolve(false);
    const { name, ...stored } = key;
    const id = crypto.randomUUID();
    this.keys.push({ ...stored, id });
    this.meta.set(id, { name, createdAt: this.clock(), lastUsedAt: null });
    return Promise.resolve(true);
  }
  touchPasskey(id: string, oldCount: number, newCount: number) {
    const k = this.keys.find((x) => x.id === id);
    if (!k || k.signCount !== oldCount) return Promise.resolve(false);
    k.signCount = newCount;
    return Promise.resolve(true);
  }
  deleteForPerson(telegramId: number) {
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => k.telegramId !== telegramId);
    return Promise.resolve(before - this.keys.length);
  }
  describeForPerson(telegramId: number): Promise<PasskeyInfo[]> {
    return Promise.resolve(
      this.keys.filter((k) => k.telegramId === telegramId).map((k) => {
        const m = this.meta.get(k.id);
        return {
          id: k.id,
          name: m?.name ?? "Browser",
          createdAt: new Date(m?.createdAt ?? 0).toISOString(),
          lastUsedAt: m?.lastUsedAt ? new Date(m.lastUsedAt).toISOString() : null,
        };
      }),
    );
  }
  deleteOwn(telegramId: number, id: string) {
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => !(k.id === id && k.telegramId === telegramId));
    return Promise.resolve(this.keys.length < before);
  }
  issueDeviceLink(telegramId: number, tokenHash: string, limits: DeviceLinkLimits) {
    const now = this.clock();
    const recent = this.links.filter((l) => l.telegramId === telegramId && l.createdAt >= now - limits.windowMs);
    if (recent.length >= limits.maxPerWindow) return Promise.resolve(false);
    for (const l of this.links) if (l.telegramId === telegramId) l.used = true;
    this.links.push({
      telegramId,
      tokenHash,
      createdAt: now,
      expiresAt: now + limits.ttlMs,
      used: false,
      challenge: null,
      challengeExpiresAt: 0,
    });
    return Promise.resolve(true);
  }
  private live(telegramId: number, tokenHash: string): DeviceLink | undefined {
    const now = this.clock();
    return this.links.find((l) =>
      l.telegramId === telegramId && l.tokenHash === tokenHash && !l.used && l.expiresAt > now
    );
  }
  armDeviceLink(telegramId: number, tokenHash: string, challenge: string, challengeTtlMs: number) {
    const l = this.live(telegramId, tokenHash);
    if (!l) return Promise.resolve(false);
    l.challenge = challenge;
    l.challengeExpiresAt = this.clock() + challengeTtlMs;
    return Promise.resolve(true);
  }
  consumeDeviceLink(telegramId: number, tokenHash: string) {
    const l = this.live(telegramId, tokenHash);
    if (!l || l.challenge === null || l.challengeExpiresAt <= this.clock()) return Promise.resolve(null);
    l.used = true;
    return Promise.resolve(l.challenge);
  }
}
