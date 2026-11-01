/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // deep blue-black surfaces (950 = page, 900/850 = panels, 700/600 = borders)
        ink: { 950: "#04060c", 900: "#080c17", 850: "#0c1221", 800: "#111a2c", 700: "#1a2439", 600: "#28334d", 500: "#3a4766" },
        ok: { DEFAULT: "#34d399", dim: "#065f46" },
        bad: { DEFAULT: "#fb7185", dim: "#881337" },
        brand: { cyan: "#22d3ee", violet: "#a78bfa", emerald: "#34d399" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52,211,153,0.35), 0 8px 30px -6px rgba(52,211,153,0.45)",
        "glow-bad": "0 0 0 1px rgba(251,113,133,0.4), 0 8px 30px -6px rgba(251,113,133,0.45)",
        "glow-cyan": "0 0 0 1px rgba(34,211,238,0.35), 0 8px 30px -6px rgba(34,211,238,0.4)",
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.8)",
      },
      keyframes: {
        "aurora-a": { "0%,100%": { transform: "translate(0,0) scale(1)" }, "50%": { transform: "translate(-6%,4%) scale(1.15)" } },
        "aurora-b": { "0%,100%": { transform: "translate(0,0) scale(1.1)" }, "50%": { transform: "translate(5%,-5%) scale(0.95)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-ring": { "0%": { transform: "scale(0.8)", opacity: "0.7" }, "100%": { transform: "scale(2.4)", opacity: "0" } },
        flow: { to: { strokeDashoffset: "-24" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
      },
      animation: {
        "aurora-a": "aurora-a 22s ease-in-out infinite",
        "aurora-b": "aurora-b 28s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.2,0.6,0.4,1) infinite",
        flow: "flow 1.2s linear infinite",
        float: "float 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
