# Local interface fonts

All 13 interface/market families use `next/font/local`. The 77 WOFF2 files are
unchanged bytes from the main-derived Next 16.4.6 build at `b79c1d1a`; 89 original
Unicode faces retain their weights, normal style, display policy and selected
preloads. Each family directory contains its unmodified SIL Open Font License.

`manifest.json` records each asset's SHA-256, the official Google CSS/font URL,
font version, coverage, weights, preload choice, and pinned license source.
The emitted baseline can differ from a current Google download in wrappers and
hinting. Coverage, variation and shaping tables plus outline coordinates were
checked against the official sources; the committed baseline bytes were not
converted, subsetted or instantiated.

Next local fonts do not expose per-source Unicode ranges. Each original subset
has its own local loader and range. The public CSS variable composes those
families without intermediate fallbacks, followed by the original fallback and
its baseline metrics. `--font-golos` keeps the same Cyrillic fallback available
to color schemes. Market variables are composed on `.mkt`, where its subset
variables are defined. This preserves the existing public variable names.

Google font hosts are unnecessary for the application build and runtime. The
production build was checked with both font hosts blocked in Node and Next's
Google-CSS test hook returning an empty map (any Google loader would fail).
The existing upstream URL regression fixture remains separate from this build.

References: [Next local fonts](https://nextjs.org/docs/app/api-reference/components/font#local-fonts),
[Google Fonts source and licenses](https://github.com/google/fonts/tree/5026800714d07231937d92eb4cceabf06e05d74e/ofl).
