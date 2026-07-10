/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        heritage: {
          DEFAULT: "#1F3A3D",
          dark: "#172B2D",
          muted: "#6B7C7D"
        },
        paper: {
          DEFAULT: "#F7F3E8",
          panel: "#FFFCF4"
        },
        gold: {
          DEFAULT: "#B68A35",
          light: "#D2B66F"
        },
        ink: "#1C1C1C"
      }
    }
  },
  plugins: []
};
