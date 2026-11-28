import localFont from "next/font/local";

// Preserve each Unicode face; no intermediate fallback separates the subsets.
const monoSubset0 = localFont({
  src: [
    { path: "./ibm-plex-mono/cyrillic-ext-c6f09ee0e0a2.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/cyrillic-ext-311098be73ea.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/cyrillic-ext-f746246b6b0b.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+460-52F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  ],
});

const monoSubset1 = localFont({
  src: [
    { path: "./ibm-plex-mono/cyrillic-77eabc24c693.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/cyrillic-c9507256e987.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/cyrillic-b64d53b3ffb7.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-cyrillic",
  preload: true,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+301,U+400-45F,U+490-491,U+4B0-4B1,U+2116" },
  ],
});

const monoSubset2 = localFont({
  src: [
    { path: "./ibm-plex-mono/symbols2-5dfe096c2fc3.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/symbols2-ca434d24cfdf.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/symbols2-078d6e57bf60.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-symbols2",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+2000-2001,U+2004-2008,U+200A,U+23B8-23BD,U+2500-259F" },
  ],
});

const monoSubset3 = localFont({
  src: [
    { path: "./ibm-plex-mono/vietnamese-7aa405510f9d.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/vietnamese-4010f58bc275.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/vietnamese-a24038dec8b8.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-vietnamese",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+102-103,U+110-111,U+128-129,U+168-169,U+1A0-1A1,U+1AF-1B0,U+300-301,U+303-304,U+308-309,U+323,U+329,U+1EA0-1EF9,U+20AB" },
  ],
});

const monoSubset4 = localFont({
  src: [
    { path: "./ibm-plex-mono/latin-ext-e2318e4993a9.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/latin-ext-ded8ac6ac236.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/latin-ext-382bddd14c18.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-latin-ext",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
});

const monoSubset5 = localFont({
  src: [
    { path: "./ibm-plex-mono/latin-52de70091213.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/latin-f17f51948d10.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono/latin-5b7716398b82.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--local-ibm-plex-mono-latin",
  preload: true,
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: "unicode-range", value: "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
});

export const mono = { variable: [monoSubset0, monoSubset1, monoSubset2, monoSubset3, monoSubset4, monoSubset5].map((font) => font.variable).join(" ") };
