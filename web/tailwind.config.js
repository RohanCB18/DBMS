import defaults from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/*
 * Theme system
 * ------------
 * Every colour the UI uses resolves to a CSS variable holding an "r g b" triplet, so a single class
 * (text-slate-300, bg-white/[0.04], border-ink-700, text-ok …) renders correctly in both themes:
 *
 *   :root / .dark  -> dark values (the Tailwind palette as-is, surfaces = deep navy)
 *   .light         -> light values (each palette mirrored: 200<->800, 300<->700, 400<->600 …,
 *                     "white" becomes near-black ink, surfaces become paper-white)
 *
 * A subtree can pin a theme by adding class="light" or class="dark" (the auditor portal pins light).
 */

const PALETTES = ["slate", "amber", "sky", "rose", "emerald", "indigo", "violet", "red", "fuchsia", "teal", "cyan", "blue", "orange", "yellow", "green"];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// light-theme mirror: a "light text on dark" shade becomes the matching "dark text on light" shade
const MIRROR = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 600, 600: 500, 700: 400, 800: 300, 900: 200, 950: 50 };

const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// surfaces: 950 = page, 900/850 = panels, 800 = raised, 700/600 = borders, 500 = strong border
const INK = {
  dark: { 950: "#0a0f1c", 900: "#0f1626", 850: "#141c2f", 800: "#1a2338", 700: "#253049", 600: "#334160", 500: "#4a5a7e" },
  light: { 950: "#f6f8fb", 900: "#eef2f7", 850: "#ffffff", 800: "#e9eef5", 700: "#dde4ee", 600: "#c7d1df", 500: "#94a3b8" },
};
// semantic + brand (dark / light). brand-violet is a warm gold accent (no purple gradients).
const SEMANTIC = {
  ok: ["#34d399", "#059669"], "ok-dim": ["#065f46", "#a7f3d0"],
  bad: ["#fb7185", "#e11d48"], "bad-dim": ["#881337", "#fecdd3"],
  cyan: ["#38bdf8", "#1d4ed8"], violet: ["#fbbf24", "#a16207"], emerald: ["#34d399", "#059669"],
  white: ["#ffffff", "#0b1220"],
};

function vars(theme) {
  const out = {};
  for (const p of PALETTES) {
    for (const s of SHADES) {
      const shade = theme === "light" ? (p === "slate" && s === 500 ? 500 : MIRROR[s]) : s;
      out[`--${p}-${s}`] = rgb(defaults[p][shade]);
    }
  }
  for (const [k, hex] of Object.entries(INK[theme])) out[`--ink-${k}`] = rgb(hex);
  for (const [k, pair] of Object.entries(SEMANTIC)) out[`--${k}`] = rgb(pair[theme === "dark" ? 0 : 1]);
  return out;
}

const palette = (p) => Object.fromEntries(SHADES.map((s) => [s, v(`${p}-${s}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(PALETTES.map((p) => [p, palette(p)])),
        white: v("white"),
        paper: "#ffffff",
        ink: Object.fromEntries(Object.keys(INK.dark).map((k) => [k, v(`ink-${k}`)])),
        ok: { DEFAULT: v("ok"), dim: v("ok-dim") },
        bad: { DEFAULT: v("bad"), dim: v("bad-dim") },
        brand: { cyan: v("cyan"), violet: v("violet"), emerald: v("emerald") },
      },
      fontFamily: {
        sans: ["Fira Sans", "system-ui", "Segoe UI", "sans-serif"],
        display: ["Fira Sans", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["Fira Code", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--ok) / 0.35), 0 8px 30px -8px rgb(var(--ok) / 0.45)",
        "glow-bad": "0 0 0 1px rgb(var(--bad) / 0.4), 0 8px 30px -8px rgb(var(--bad) / 0.45)",
        "glow-cyan": "0 0 0 1px rgb(var(--cyan) / 0.35), 0 8px 30px -8px rgb(var(--cyan) / 0.4)",
        panel: "var(--shadow-panel)",
        lift: "var(--shadow-lift)",
      },
      keyframes: {
        "aurora-a": { "0%,100%": { transform: "translate(0,0) scale(1)" }, "50%": { transform: "translate(-6%,4%) scale(1.15)" } },
        "aurora-b": { "0%,100%": { transform: "translate(0,0) scale(1.1)" }, "50%": { transform: "translate(5%,-5%) scale(0.95)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-ring": { "0%": { transform: "scale(0.8)", opacity: "0.7" }, "100%": { transform: "scale(2.4)", opacity: "0" } },
        flow: { to: { strokeDashoffset: "-24" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        "border-beam": { "100%": { offsetDistance: "100%" } },
        "shine": { "0%": { backgroundPosition: "0% 0%" }, "50%": { backgroundPosition: "100% 100%" }, "100%": { backgroundPosition: "0% 0%" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(calc(-50% - 0.5rem))" } },
      },
      animation: {
        "aurora-a": "aurora-a 22s ease-in-out infinite",
        "aurora-b": "aurora-b 28s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.2,0.6,0.4,1) infinite",
        flow: "flow 1.2s linear infinite",
        float: "float 5s ease-in-out infinite",
        "border-beam": "border-beam calc(var(--duration)*1s) infinite linear",
        shine: "shine var(--duration) infinite linear",
        marquee: "marquee 40s linear infinite",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root, .dark": {
          ...vars("dark"),
          colorScheme: "dark",
          "--shadow-panel": "0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 24px 48px -28px rgb(0 0 0 / 0.85)",
          "--shadow-lift": "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 30px 60px -30px rgb(0 0 0 / 0.9)",
          "--glass-a": "rgb(255 255 255 / 0.05)",
          "--glass-b": "rgb(255 255 255 / 0.018)",
          "--page": "#0a0f1c",
        },
        // the Tailwind palette exactly as written (used by the auditor portal, which is designed light-on-paper)
        ".palette-native": { ...vars("dark"), colorScheme: "light", "--page": "#f4f1ea" },
        ".light": {
          ...vars("light"),
          colorScheme: "light",
          "--shadow-panel": "0 1px 2px rgb(15 23 42 / 0.04), 0 12px 32px -16px rgb(15 23 42 / 0.14)",
          "--shadow-lift": "0 2px 4px rgb(15 23 42 / 0.05), 0 24px 48px -20px rgb(15 23 42 / 0.22)",
          "--glass-a": "rgb(255 255 255 / 0.92)",
          "--glass-b": "rgb(255 255 255 / 0.78)",
          "--page": "#f6f8fb",
        },
      });
    }),
  ],
};
