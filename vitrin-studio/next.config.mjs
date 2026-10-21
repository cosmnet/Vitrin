import { existsSync } from "node:fs";

// Tanıtım sayfası (app/(marketing)) yayımlanmaz; yoksa kök adres stüdyoya gider.
const hasLanding = existsSync(new URL("./app/(marketing)/page.tsx", import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.VITRIN_DIST_DIR || ".next",
  async redirects() {
    return hasLanding ? [] : [{ source: "/", destination: "/studio", permanent: false }];
  },
};
export default nextConfig;
