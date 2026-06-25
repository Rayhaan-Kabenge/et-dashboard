import type { Config } from "tailwindcss";

// Single source of truth for color. Hex literals live ONLY here (design tokens);
// components reference token names, never ad-hoc hex.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- core surfaces / text ---
        ink: "#14201A",
        canvas: "#FBFAF7",
        card: "#FFFFFF",
        hairline: "#E7E5DF",
        muted: "#6B7069",

        // --- brand ---
        brand: { DEFAULT: "#1F5132", accent: "#2E7D49" },

        // --- subject matter: soil + water ---
        water: { DEFAULT: "#1E6FA8", soft: "#E3EFF7", 400: "#3D8FC4", 500: "#1E6FA8" },
        soil: { DEFAULT: "#9A6440", deep: "#5E3B26", soft: "#F0E7DE", 400: "#9A6440", 500: "#9A6440", 600: "#5E3B26" },

        // --- status system (hold / soon / now) — paired with icon + label ---
        status: { hold: "#1F5132", soon: "#C9821F", now: "#C0392B" },
        amber: { DEFAULT: "#C9821F", 400: "#C9821F", 500: "#C9821F" },
        danger: "#C0392B",

        // --- shadcn semantic aliases (mapped to our palette) ---
        background: "#FBFAF7",
        foreground: "#14201A",
        border: "#E7E5DF",
        input: "#E7E5DF",
        ring: "#1F5132",
        primary: { DEFAULT: "#1F5132", foreground: "#FBFAF7" },
        secondary: { DEFAULT: "#F0EFEA", foreground: "#14201A" },
        accent: { DEFAULT: "#EEF3EF", foreground: "#1F5132" },
        destructive: { DEFAULT: "#C0392B", foreground: "#FFFFFF" },
        popover: { DEFAULT: "#FFFFFF", foreground: "#14201A" },
        "muted-foreground": "#6B7069",

        // --- compatibility shims for not-yet-migrated components (mapped to the
        //     new palette so the build stays green during the staged rollout) ---
        leaf: { 50: "#EEF3EF", 100: "#DCE8DF", 400: "#2E7D49", 500: "#2E7D49", 600: "#1F5132", 700: "#173D26" },
        sky: { 400: "#3D8FC4", 500: "#1E6FA8" },
        clay: { 400: "#D06149", 500: "#C0392B" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "12px",
        xl2: "12px",
        md: "10px",
        sm: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,32,26,0.04)",
        hero: "0 1px 3px rgba(20,32,26,0.06), 0 8px 28px rgba(20,32,26,0.06)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
