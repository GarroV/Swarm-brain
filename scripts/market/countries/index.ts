import { EE } from "./EE.ts";
import { HR } from "./HR.ts";
import { RO } from "./RO.ts";
import { RS } from "./RS.ts";
import { SI } from "./SI.ts";
import type { CountryConfig } from "./types.ts";

export const COUNTRIES: Record<string, CountryConfig> = { HR, RO, EE, RS, SI };
