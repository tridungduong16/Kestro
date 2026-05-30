import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        surface: "#1A1F2B",
        ink: "#111827",
        chronos: {
          cyan: "#06B6D4",
          mint: "#10B981",
          amber: "#F59E0B",
          red: "#EF4444",
          violet: "#6366F1"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        panel: "0 18px 55px rgba(17, 24, 39, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

