import localFont from "next/font/local";

// Preserve each Unicode face; no intermediate fallback separates the subsets.
const fInterTightSubset0 = localFont({
  src: [
    { path: "./inter-tight/cyrillic-ext-4a89b86d992e.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+460-52F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  ],
});

const fInterTightSubset1 = localFont({
  src: [
    { path: "./inter-tight/cyrillic-04e865409d6f.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-cyrillic",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+301,U+400-45F,U+490-491,U+4B0-4B1,U+2116" },
  ],
});

const fInterTightSubset2 = localFont({
  src: [
    { path: "./inter-tight/greek-ext-0c930dc2267b.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-greek-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+1F??" },
  ],
});

const fInterTightSubset3 = localFont({
  src: [
    { path: "./inter-tight/greek-67b5c3cea0f6.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-greek",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+370-377,U+37A-37F,U+384-38A,U+38C,U+38E-3A1,U+3A3-3FF" },
  ],
});

const fInterTightSubset4 = localFont({
  src: [
    { path: "./inter-tight/vietnamese-c753c7f9f2dc.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-vietnamese",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+102-103,U+110-111,U+128-129,U+168-169,U+1A0-1A1,U+1AF-1B0,U+300-301,U+303-304,U+308-309,U+323,U+329,U+1EA0-1EF9,U+20AB" },
  ],
});

const fInterTightSubset5 = localFont({
  src: [
    { path: "./inter-tight/latin-ext-3c299662298b.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-latin-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
});

const fInterTightSubset6 = localFont({
  src: [
    { path: "./inter-tight/latin-83d548cd73ef.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--local-inter-tight-latin",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
});

export const fInterTight = { variable: [fInterTightSubset0, fInterTightSubset1, fInterTightSubset2, fInterTightSubset3, fInterTightSubset4, fInterTightSubset5, fInterTightSubset6].map((font) => font.variable).join(" ") };
