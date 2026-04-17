import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d10",
        paper: "#f7f7f5",
      },
    },
  },
  plugins: [],
} satisfies Config;
