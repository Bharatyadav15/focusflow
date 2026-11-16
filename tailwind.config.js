/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0b0e14',
          800: '#121722',
          700: '#1a2130',
          600: '#242e42',
        },
        accent: {
          500: '#6366f1',
          400: '#818cf8',
        },
      },
    },
  },
  plugins: [],
};
