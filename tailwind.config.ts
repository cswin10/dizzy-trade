import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1A1F36',
          deep: '#141829',
        },
        accent: {
          DEFAULT: '#2979FF',
          hover: '#3B85FF',
        },
        teal: '#50E3C2',
        light: '#F2F4F8',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
