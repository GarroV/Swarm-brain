import localFont from "next/font/local";

// Preserve each Unicode face; no intermediate fallback separates the subsets.
const golosSubset0 = localFont({
  src: [
    { path: "./golos-text/cyrillic-ext-10aa879203c4.woff2", weight: "400 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-golos-text-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+460-52F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  ],
});

const golosSubset1 = localFont({
  src: [
    { path: "./golos-text/cyrillic-2f175b8fc40e.woff2", weight: "400 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-golos-text-cyrillic",
  preload: true,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+301,U+400-45F,U+490-491,U+4B0-4B1,U+2116" },
  ],
});

const golosSubset2 = localFont({
  src: [
    { path: "./golos-text/latin-ext-90256a7b8eb3.woff2", weight: "400 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-golos-text-latin-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
});

const golosSubset3 = localFont({
  src: [
    { path: "./golos-text/latin-f8d71091110f.woff2", weight: "400 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-golos-text-latin",
  preload: true,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
});

export const golos = { variable: [golosSubset0, golosSubset1, golosSubset2, golosSubset3].map((font) => font.variable).join(" ") };
