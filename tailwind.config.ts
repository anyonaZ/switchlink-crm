import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12172B",
        slate: { 950: "#0B0E1A" },
        brand: {
          50: "#EEF2FB", 100: "#DDE4F7", 200: "#B9C7EA", 300: "#879BD0", 400: "#5C78BE",
          500: "#2D51B4", 600: "#24439A", 700: "#1D377F", 800: "#192F6B", 900: "#152653", 950: "#0D1838",
        },
        accent: {
          50: "#FFF0F1", 100: "#FFDADC", 200: "#FFB8BB", 300: "#FF8589", 400: "#FB4D52",
          500: "#FA161A", 600: "#D91014", 700: "#B20D11", 800: "#8D0A0E", 900: "#6D080B",
        },
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgba(18, 23, 43, 0.06), 0 1px 1px rgba(18, 23, 43, 0.04)",
        sheet: "0 -8px 32px rgba(18, 23, 43, 0.18)",
      },
      keyframes: {
        "toploader-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "60%": { transform: "translateX(20%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "sheet-up": { "0%": { transform: "translateY(100%)" }, "100%": { transform: "translateY(0)" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "toast-in": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "toploader-sweep": "toploader-sweep 1.1s cubic-bezier(0.65, 0, 0.35, 1) infinite",
        "sheet-up": "sheet-up 0.22s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.18s ease both",
        "toast-in": "toast-in 0.2s ease both",
      },
    },
  },
  plugins: [],
};
export default config;
