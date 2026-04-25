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
        // Two stacked gradients. The radial sits on top and gives every
        // panel a faint accent-blue glow in the upper-left, as if lit by
        // a blue light source off-screen. The linear underneath fakes the
        // classic top-lit surface highlight.
        'panel-lit':
          'radial-gradient(ellipse at 20% 20%, rgba(59, 130, 255, 0.04), transparent 60%), linear-gradient(to bottom, rgba(255, 255, 255, 0.02), transparent 40%)',
        // CRT-style scanlines used by the analytics page only. Kept
        // very low contrast so it reads as texture, not a pattern.
        scanlines:
          'repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 0px, rgba(255, 255, 255, 0.02) 1px, transparent 1px, transparent 3px)',
        // Filter bar accent fade: 1px tall horizontal gradient from
        // accent-blue at the left to transparent on the right.
        'analytics-filter-fade':
          'linear-gradient(to right, rgba(59, 130, 255, 0.5), transparent)',
      },
      keyframes: {
        'chart-enter': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'chart-enter': 'chart-enter 300ms ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
