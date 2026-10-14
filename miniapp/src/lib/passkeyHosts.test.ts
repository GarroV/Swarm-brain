// Список адресов, с которых принимается ключ доступа (`supabase/functions/_shared/passkeys/rp.ts`),
// обязан совпадать со списком боевых адресов веба (`prodHosts.ts`): сервер не может импортировать веб,
// поэтому копию держит этот тест. Разошлись — вход пальцем с нового боевого адреса молча не работает.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PROD_HOSTS } from "./prodHosts.ts";
import { relyingPartyFor } from "../../../supabase/functions/_shared/passkeys/rp.ts";

Deno.test("каждый боевой адрес веба принимается ключами доступа, RP ID — его хост", () => {
  for (const host of PROD_HOSTS) assertEquals(relyingPartyFor(`https://${host}`)?.rpID, host);
});

Deno.test("боевой адрес, которого нет в списке веба, ключами не принимается", () => {
  assertEquals(relyingPartyFor("https://swarm-team.example"), null);
});
