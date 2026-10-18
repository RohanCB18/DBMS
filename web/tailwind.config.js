/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070b10", 900: "#0b1118", 850: "#0f1620", 800: "#131c28", 700: "#1c2735", 600: "#2a3848", 500: "#3d4e63" },
        ok: { DEFAULT: "#34d399", dim: "#065f46" },
        bad: { DEFAULT: "#f87171", dim: "#7f1d1d" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
