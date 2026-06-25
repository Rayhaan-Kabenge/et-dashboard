import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // calm agronomy palette
        canvas: "#f6f7f4",
        ink: "#1b2420",
        leaf: {
          50: "#f0f7f0",
          100: "#dcebda",
          400: "#5a9d5a",
          500: "#3f8a45",
          600: "#2f6b36",
          700: "#26562c",
        },
        soil: {
          400: "#b08968",
          500: "#94653f",
          600: "#7a4f2f",
        },
        sky: {
          400: "#5aa9d6",
          500: "#3f8fc0",
        },
        amber: {
          400: "#e0a23a",
          500: "#cf8a1c",
        },
        clay: {
          400: "#d4694a",
          500: "#bf4a2c",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27,36,32,0.04), 0 4px 16px rgba(27,36,32,0.06)",
        hero: "0 2px 4px rgba(27,36,32,0.05), 0 12px 40px rgba(27,36,32,0.10)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
