import { golos } from "./golos-text";
import { mono } from "./ibm-plex-mono";
import { fSourceSerif } from "./source-serif-4";
import { fOswald } from "./oswald";
import { fSpaceGrotesk } from "./space-grotesk";
import { fFraunces } from "./fraunces";
import { fAtkinson } from "./atkinson-hyperlegible";
import { fManrope } from "./manrope";
import { fSora } from "./sora";
import { fPlexSans } from "./ibm-plex-sans";
import { fInterTight } from "./inter-tight";

export const interfaceFontVariables = [golos, mono, fSourceSerif, fOswald, fSpaceGrotesk, fFraunces, fAtkinson, fManrope, fSora, fPlexSans, fInterTight].map((font) => font.variable).join(" ");
