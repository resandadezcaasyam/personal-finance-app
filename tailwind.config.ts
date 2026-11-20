import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        sunken: "hsl(var(--sunken) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        brand: "hsl(var(--brand) / <alpha-value>)",
        "brand-ink": "hsl(var(--brand-ink) / <alpha-value>)",
        gain: "hsl(var(--gain) / <alpha-value>)",
        loss: "hsl(var(--loss) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Segoe UI"', "system-ui", "-apple-system", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        display: ['"Cambria"', '"Georgia"', "ui-serif", "serif"],
      },
      borderRadius: { card: "10px" },
    },
  },
  plugins: [],
};
export default config;
