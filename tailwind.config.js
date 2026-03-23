/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./dashboard.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          border: "#1a1a1a",
          bg: "#050505",
          accent: "#00f3ff",
          muted: "#888888"
        }
      }
    },
  },
  plugins: [],
}
