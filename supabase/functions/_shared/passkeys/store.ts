// Хранилище ключей и вызовов. Интерфейс отделён от Supabase, чтобы ядро (flow.ts) гонялось в
// тестах на настоящей криптографии без базы; боевая реализация — supabaseStore ниже.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ChallengePurpose = "register" | "authenticate";

export type StoredPasskey = {
  id: string;
  telegramId: number;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
};

export type NewPasskey = Omit<StoredPasskey, "id"> & { name: string };

export interface PasskeyStore {
  /** Ключи человека. */
  listForPerson(telegramId: number): Promise<StoredPasskey[]>;
  /** Сколько вызовов выдано человеку с момента `sinceMs` (ограничитель попыток). */
  countChallengesSince(telegramId: number, sinceMs: number): Promise<number>;
  /** Запомнить вызов; прежние неснятые вызовы человека вытесняются. */
  putChallenge(telegramId: number, purpose: ChallengePurpose, challenge: string, expiresAtMs: number): Promise<void>;
  /** Снять вызов ОДИН раз: нет, чужой или просрочен — null; снятый не вернётся. */
  takeChallenge(telegramId: number, nowMs: number): Promise<{ purpose: ChallengePurpose; challenge: string } | null>;
  /** Ключ по номеру; нет такого — null. */
  findByCredential(credentialId: string): Promise<StoredPasskey | null>;
  insertPasskey(key: NewPasskey): Promise<boolean>;
  /** Принять новый счётчик — только если в базе всё ещё прежний (гонка проигрывает). */
  touchPasskey(id: string, oldCount: number, newCount: number): Promise<boolean>;
  /** Снять все ключи человека (ручной сброс входа); возвращает сколько снято. */
  deleteForPerson(telegramId: number): Promise<number>;
}

type Row = {
  id: string;
  telegram_id: number;
  credential_id: string;
  public_key: string;
  sign_count: number | string;
  transports: string[] | null;
};

const COLUMNS = "id, telegram_id, credential_id, public_key, sign_count, transports";

const toKey = (r: Row): StoredPasskey => ({
  id: r.id,
  telegramId: Number(r.telegram_id),
  credentialId: r.credential_id,
  publicKey: r.public_key,
  signCount: Number(r.sign_count),
  transports: r.transports ?? [],
});

export function supabaseStore(supabase: SupabaseClient): PasskeyStore {
  const fail = (where: string, error: { message: string } | null): never => {
    throw new Error(`passkeys: ${where}: ${error?.message ?? "unknown"}`);
  };
  return {
    async listForPerson(telegramId) {
      const { data, error } = await supabase.from("passkeys").select(COLUMNS).eq("telegram_id", telegramId);
      if (error) fail("list", error);
      return ((data ?? []) as Row[]).map(toKey);
    },
    async countChallengesSince(telegramId, sinceMs) {
      const { count, error } = await supabase.from("passkey_challenges")
        .select("id", { count: "exact", head: true })
        .eq("telegram_id", telegramId)
        .gte("created_at", new Date(sinceMs).toISOString());
      if (error) fail("count", error);
      return count ?? 0;
    },
    async putChallenge(telegramId, purpose, challenge, expiresAtMs) {
      // Прежние НЕснятые гасим, а не удаляем: действует только последний вызов, а строки остаются —
      // по ним ограничитель считает, сколько вызовов выдано за окно.
      const del = await supabase.from("passkey_challenges").update({ used_at: new Date().toISOString() })
        .eq("telegram_id", telegramId).is("used_at", null);
      if (del.error) fail("retire old challenges", del.error);
      const { error } = await supabase.from("passkey_challenges").insert({
        telegram_id: telegramId,
        purpose,
        challenge,
        expires_at: new Date(expiresAtMs).toISOString(),
      });
      if (error) fail("put challenge", error);
    },
    async takeChallenge(telegramId, nowMs) {
      // Один UPDATE ... WHERE used_at IS NULL ... RETURNING — снятие атомарно: два параллельных
      // предъявления одного вызова не пройдут оба.
      const { data, error } = await supabase.from("passkey_challenges")
        .update({ used_at: new Date(nowMs).toISOString() })
        .eq("telegram_id", telegramId)
        .is("used_at", null)
        .gt("expires_at", new Date(nowMs).toISOString())
        .select("purpose, challenge");
      if (error) fail("take challenge", error);
      const row = ((data ?? []) as Array<{ purpose: ChallengePurpose; challenge: string }>)[0];
      return row ? { purpose: row.purpose, challenge: row.challenge } : null;
    },
    async findByCredential(credentialId) {
      const { data, error } = await supabase.from("passkeys").select(COLUMNS).eq("credential_id", credentialId)
        .maybeSingle();
      if (error) fail("find", error);
      return data ? toKey(data as Row) : null;
    },
    async insertPasskey(key) {
      const { error } = await supabase.from("passkeys").insert({
        telegram_id: key.telegramId,
        credential_id: key.credentialId,
        public_key: key.publicKey,
        sign_count: key.signCount,
        transports: key.transports,
        name: key.name,
      });
      if (error) {
        // Номер уже занят (двойной клик): не авария, ключ уже сохранён.
        if ((error as { code?: string }).code === "23505") return false;
        fail("insert", error);
      }
      return true;
    },
    async touchPasskey(id, oldCount, newCount) {
      const { data, error } = await supabase.from("passkeys")
        .update({ sign_count: newCount, last_used_at: new Date().toISOString() })
        .eq("id", id)
        .eq("sign_count", oldCount)
        .select("id");
      if (error) fail("touch", error);
      return (data ?? []).length > 0;
    },
    async deleteForPerson(telegramId) {
      const { data, error } = await supabase.from("passkeys").delete().eq("telegram_id", telegramId).select("id");
      if (error) fail("delete", error);
      return (data ?? []).length;
    },
  };
}
