/**
 * Разовый (и безопасный к повторам) скрипт: зашифровать открытые ключи Granola в
 * `user_integrations.api_key` (#585). Те же строки дошифровывает и часовой проход
 * `swarm-bot` (`granola_poll`), так что руками скрипт нужен только чтобы не ждать час.
 *
 * Нужны: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и WORKSPACE_SECRETS_KEY (тот же, что у функций:
 * другим ключом дошифрованное функции не прочтут). Без последнего скрипт ничего не пишет.
 *
 *   DRY_RUN=1 deno run --allow-net --allow-env scripts/seal-granola-keys.ts   # только счёт
 *   deno run --allow-net --allow-env scripts/seal-granola-keys.ts
 *
 * Печатает только числа; ключи и шифротексты не печатает.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sealLegacyKeys } from "../supabase/functions/_shared/integration-keys.ts";
import { secretsKeyConfigured } from "../supabase/functions/_shared/secret-box.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const dryRun = Deno.env.get("DRY_RUN") === "1";

if (!url || !serviceKey) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}
if (!dryRun && !secretsKeyConfigured()) {
  console.error("WORKSPACE_SECRETS_KEY не задан или не base64 от 32 байт: шифровать нечем");
  Deno.exit(1);
}

const result = await sealLegacyKeys(createClient(url, serviceKey), "granola", dryRun);
console.log(`${dryRun ? "DRY RUN: " : ""}sealed=${result.sealed} alreadySealed=${result.alreadySealed} failed=${result.failed}`);
if (result.failed > 0) Deno.exit(1);
