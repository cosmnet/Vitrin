"use client";

import dynamic from "next/dynamic";

// Motor DOM/WebGL kullanıyor — sadece istemcide yükle.
const Studio = dynamic(() => import("@/components/Studio"), { ssr: false });

export default function StudioPage() {
  return <Studio />;
}
