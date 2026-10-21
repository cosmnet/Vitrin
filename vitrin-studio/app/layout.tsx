import type { Metadata } from "next";
import "./globals.css";
import "./studio-next.css";

export const metadata: Metadata = {
  title: "Vitrin Studio",
  description: "App Store review görselleri — otomatik, tekrarlanabilir, düzenlenebilir.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
