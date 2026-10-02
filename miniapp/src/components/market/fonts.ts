// Шрифты эталона «Анализа рынка» (Inter + JetBrains Mono). Только для этого раздела и без
// предзагрузки: остальной Swarm набран Golos Text и не должен за них платить.
import { Inter, JetBrains_Mono } from "next/font/google";

export const mktSans = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-mkt", display: "swap", preload: false });
export const mktMono = JetBrains_Mono({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-mkt-mono", display: "swap", preload: false });
