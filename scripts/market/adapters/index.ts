import { dodo } from "./dodo.ts";
import { eeAriregister } from "./ee-ariregister.ts";
import { osm } from "./osm.ts";
import { roDatagov } from "./ro-datagov.ts";
import type { Adapter } from "./types.ts";

export const ADAPTERS: Record<string, Adapter> = Object.fromEntries(
  [dodo, osm, eeAriregister, roDatagov].map((a) => [a.id, a]),
);
