/**
 * PostCSS — SADECE marketing rotası için Tailwind v4.
 *
 * Tailwind v4'ün postcss eklentisi, içinde `@import "tailwindcss"` (ya da
 * `@tailwind` / `@apply` gibi at-rule'lar) bulunmayan dosyaları hızlı yoldan
 * dokunmadan geçirir. `app/globals.css` (stüdyo UI v2 dili) hiçbir Tailwind
 * direktifi içermez → çıktısı birebir aynı kalır.
 *
 * Tailwind YALNIZ `app/(marketing)/marketing.css` içinde import edilir ve o CSS
 * yalnız `(marketing)` route-group layout'undan yüklenir; Next.js route bazlı
 * CSS böler, bu yüzden /studio'ya tek satır Tailwind (preflight dahil) gitmez.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
