"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label,
  className = "btn btn-ghost",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older in-app browsers block the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  }

  return (
    <button onClick={copy} className={className} data-testid="copy-button">
      {done ? "Copied ✓" : label}
    </button>
  );
}
