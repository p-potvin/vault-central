/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./dashboard-v2.html",
    "./dashboard.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "var(--vault-bg)",
          surface: "var(--vault-surface)",
          surfaceElevated: "var(--vault-surface-elevated)",
          text: "var(--vault-text)",
          textSecondary: "var(--vault-text-secondary)",
          border: "var(--vault-border)",
          muted: "var(--vault-muted)",
          accent: "var(--vault-accent)",
          accentHover: "var(--vault-accent-hover)",
          focusRing: "var(--vault-focus-ring)",
          cardBg: "var(--vault-card-bg)",
          success: "var(--vault-success)",
          warning: "var(--vault-warning)",
          danger: "var(--vault-danger)",
        }
      },
      fontFamily: {
        sans: ['"Segoe UI Semilight"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
      },
      /* NOTE (Mon, 03 Aug 2026): there used to be a `spacing` override here that
       * remapped 0.5/1/1.5/2/3/4/5/6/8 to 4/8/12/16/24/32/40/48/64px in the name of
       * an "8px grid". Tailwind's default scale is already a 4px grid, so this
       * doubled every padding, margin and gap in the app — and, worse, it only
       * covered *some* keys. `h-5` became 40px while `w-9` stayed 36px, which is
       * why the Master PIN toggle rendered as a circle instead of a pill.
       * Do not reintroduce it. Use the default scale; it is the 8px grid at even
       * numbers (p-2 = 8px, p-4 = 16px, p-6 = 24px).
       */
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
