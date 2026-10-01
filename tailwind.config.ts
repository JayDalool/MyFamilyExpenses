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
        brand: {
          50: "#f3faf7",
          100: "#d8f3e5",
          500: "#2e8b57",
          600: "#267246",
          700: "#1f5d3a",
        },
      },
      boxShadow: {
        soft: "0 16px 48px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
