// Хранилище в памяти для тестов ядра: та же семантика, что у supabaseStore (снятие вызова один
// раз, сравнение счётчика, вытеснение прежних вызовов), без базы.
import type { ChallengePurpose, NewPasskey, PasskeyStore, StoredPasskey } from "./store.ts";

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
  private seq = 0;

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
    this.keys.push({ ...key, id: `k${++this.seq}` });
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
}
