import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#050708',
        surface: {
          1: '#111418',
          2: '#1B2027',
        },
        border: '#2A3038',
        text: {
          DEFAULT: '#F5F3EF',
          muted: '#AEB4BD',
        },
        primary: {
          DEFAULT: '#FF3D0A',
          hover: '#FF5A24',
          dark: '#B92808',
        },
        // Holographic accents — use sparingly per CLAUDE.md.
        holo: {
          cyan: '#22D3EE',
          violet: '#A855F7',
          lime: '#A3E635',
        },
        warning: '#FACC15',
        success: '#22C55E',
        error: '#EF4444',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '18px',
        xl: '24px',
      },
      boxShadow: {
        card: '0 12px 40px rgba(0, 0, 0, 0.35)',
        // Brand glow for primary CTAs on hover.
        orange: '0 0 24px rgba(255, 61, 10, 0.45)',
        cyan: '0 0 24px rgba(34, 211, 238, 0.35)',
      },
      fontFamily: {
        // Inter is the default; swap to Satoshi/Manrope by adding @fontsource/* later.
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
      // Typography scale from design pack §2.2
      fontSize: {
        'display-xl': ['64px', '72px'],
        'display-lg': ['48px', '56px'],
        h1: ['40px', '48px'],
        h2: ['32px', '40px'],
        h3: ['24px', '32px'],
        // base/sm/xs are Tailwind defaults; the pack's body/small/micro map cleanly.
      },
    },
  },
  plugins: [],
} satisfies Config
