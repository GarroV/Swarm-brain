import localFont from "next/font/local";

// Preserve each Unicode face; no intermediate fallback separates the subsets.
const fSpaceGroteskSubset0 = localFont({
  src: [
    { path: "./space-grotesk/vietnamese-d699664b145b.woff2", weight: "300 700", style: "normal" },
  ],
  display: "swap",
  variable: "--local-space-grotesk-vietnamese",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+102-103,U+110-111,U+128-129,U+168-169,U+1A0-1A1,U+1AF-1B0,U+300-301,U+303-304,U+308-309,U+323,U+329,U+1EA0-1EF9,U+20AB" },
  ],
});

const fSpaceGroteskSubset1 = localFont({
  src: [
    { path: "./space-grotesk/latin-ext-054c266fbb44.woff2", weight: "300 700", style: "normal" },
  ],
  display: "swap",
  variable: "--local-space-grotesk-latin-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
});

const fSpaceGroteskSubset2 = localFont({
  src: [
    { path: "./space-grotesk/latin-a0d054c4af55.woff2", weight: "300 700", style: "normal" },
  ],
  display: "swap",
  variable: "--local-space-grotesk-latin",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
});

export const fSpaceGrotesk = { variable: [fSpaceGroteskSubset0, fSpaceGroteskSubset1, fSpaceGroteskSubset2].map((font) => font.variable).join(" ") };
