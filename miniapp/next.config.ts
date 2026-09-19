import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

// Локальный стенд: при заданном STAND_API запросы `/api/*` уходят на него (см.
// `scripts/dev-stand.ts`), и продукт в dev работает целиком — веб, API и демо-вход на одном
// адресе. Без переменной поведение не меняется ни на грамм: прод собирается статикой
// (`output: "export"`), где rewrites не применяются вовсе.
if (process.env.STAND_API) {
  nextConfig.rewrites = async () => [
    { source: "/api/:path*", destination: `${process.env.STAND_API}/api/:path*` },
  ];
}

export default nextConfig;
