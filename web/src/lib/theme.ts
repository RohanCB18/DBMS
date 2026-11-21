import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "ztdb-theme";

function current(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function apply(t: Theme) {
  const r = document.documentElement;
  r.classList.add("theme-switching");
  r.classList.remove("light", "dark");
  r.classList.add(t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f6f8fb" : "#0a0f1c");
  window.setTimeout(() => r.classList.remove("theme-switching"), 400);
  window.dispatchEvent(new CustomEvent("ztdb-theme", { detail: t }));
}

/** Current theme + toggle. Persists the choice; with no saved choice it follows the OS. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("ztdb-theme", onChange);
    // follow OS changes while the user has not chosen explicitly
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const onOs = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
      if (!saved) apply(e.matches ? "light" : "dark");
    };
    mq?.addEventListener?.("change", onOs);
    return () => { window.removeEventListener("ztdb-theme", onChange); mq?.removeEventListener?.("change", onOs); };
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = current() === "light" ? "dark" : "light";
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked: still switch for this visit */ }
    apply(next);
  }, []);

  return { theme, toggle };
}

/** Read a theme colour variable as a CSS colour, e.g. tok("ok") -> "rgb(var(--ok))". */
export const tok = (name: string, alpha?: number) => (alpha === undefined ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${alpha})`);
