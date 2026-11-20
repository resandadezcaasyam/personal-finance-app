import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        sidebar: token("sidebar"),
        sunken: token("sunken"),
        line: token("line"),
        ink: token("ink"),
        muted: token("muted"),
        brand: token("brand"),
        "brand-hover": token("brand-hover"),
        "brand-ink": token("brand-ink"),
        gain: token("gain"),
        loss: token("loss"),
        warn: token("warn"),
        "warn-fill": token("warn-fill"),
      },
      fontFamily: {
        // Inter ships with the app (@fontsource-variable/inter): no CDN, works offline.
        sans: ['"Inter Variable"', "Inter", '"Segoe UI"', "system-ui", "-apple-system", "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        // Kept as an alias so existing `font-display` headings are now sans-serif too.
        display: ['"Inter Variable"', "Inter", '"Segoe UI"', "system-ui", "-apple-system", "Roboto", "Arial", "sans-serif"],
      },
      borderRadius: { card: "14px" },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        pop: "0 8px 24px -6px rgb(15 23 42 / 0.18), 0 2px 6px -2px rgb(15 23 42 / 0.08)",
      },
    },
  },
  plugins: [
    // `collapsed:` applies only on desktop when the sidebar is collapsed (the mobile drawer is never collapsed).
    plugin(({ addVariant }) => { addVariant("collapsed", "@media (min-width: 1024px) { html[data-sidebar='collapsed'] & }"); }),
  ],
};
export default config;
