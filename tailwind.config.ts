import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0A0B0E',
        surface: {
          DEFAULT: '#14161C',
          2: '#1B1E26',
        },
        accent: {
          DEFAULT: '#3B82FF',
          glow: 'rgba(59, 130, 255, 0.35)',
        },
        positive: '#4ADE80',
        negative: '#F87171',
        warning: '#F59E0B',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'panel-lit':
          'linear-gradient(to bottom, rgba(255, 255, 255, 0.02), transparent 40%)',
      },
    },
  },
  plugins: [],
}

export default config
