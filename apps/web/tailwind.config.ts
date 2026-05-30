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
        surface: "#0f1011",
        ink: "#f7f8f8",
        linear: {
          black: "#08090a",
          graphite: "#0f1011",
          slate: "#161718",
          charcoal: "#23252a",
          ash: "#323334",
          gunmetal: "#383b3f",
          porcelain: "#f7f8f8",
          steel: "#d0d6e0",
          storm: "#8a8f98",
          fog: "#62666d",
          lime: "#e4f222",
          blue: "#5e6ad2",
          cyan: "#02b8cc",
          emerald: "#27a644",
          red: "#eb5757"
        },
        kestro: {
          cyan: "#e4f222",
          mint: "#27a644",
          amber: "#e4f222",
          red: "#eb5757",
          violet: "#5e6ad2"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Berkeley Mono", "IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        panel: "0 2px 4px rgba(0, 0, 0, 0.4)",
        "linear-inset": "rgb(35, 37, 42) 0px 0px 0px 1px inset",
        "linear-xl": "rgba(8, 9, 10, 0.6) 0px 4px 32px 0px"
      }
    }
  },
  plugins: []
};

export default config;
