import localFont from "next/font/local";

// Preserve each Unicode face; no intermediate fallback separates the subsets.
const fAtkinsonSubset0 = localFont({
  src: [
    { path: "./atkinson-hyperlegible/latin-ext-e15e89caea88.woff2", weight: "400", style: "normal" },
    { path: "./atkinson-hyperlegible/latin-ext-69b102985322.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--local-atkinson-hyperlegible-latin-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
});

const fAtkinsonSubset1 = localFont({
  src: [
    { path: "./atkinson-hyperlegible/latin-a60206dd4793.woff2", weight: "400", style: "normal" },
    { path: "./atkinson-hyperlegible/latin-1cc7c0c5fbf1.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--local-atkinson-hyperlegible-latin",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
});

export const fAtkinson = { variable: [fAtkinsonSubset0, fAtkinsonSubset1].map((font) => font.variable).join(" ") };
