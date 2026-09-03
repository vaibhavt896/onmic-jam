"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps the server-rendered admin tiles live without turning them into an API. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
