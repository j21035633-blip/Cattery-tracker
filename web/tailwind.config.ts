import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm, low-contrast palette; the app is read at a glance in a cattery.
        cream: "#faf7f2",
        ink: "#1f2421",
        moss: { 50: "#f1f6f2", 100: "#dcebe0", 500: "#4a7c59", 600: "#3d6849", 700: "#2f5138" },
        clay: { 100: "#fbe9e0", 500: "#c96f4a", 600: "#ad5b39" },
        amber: { 100: "#fdf0d5", 500: "#d99b32", 600: "#b87f22" },
      },
      screens: {
        // Tablet portrait is a first-class layout, not a squeezed desktop.
        tablet: "768px",
        desktop: "1180px",
      },
    },
  },
  plugins: [],
};

export default config;
