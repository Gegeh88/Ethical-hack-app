import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Sovereign Terminal palette
        void: '#131313',
        pulse: {
          DEFAULT: '#00FF41',
          dim: '#00e639',
          fixed: '#72ff70',
          soft: '#ebffe2',
        },
        forge: {
          DEFAULT: '#ffb77b',
          dark: '#7a4100',
          light: '#ffdcc2',
        },
        ghost: '#b9ccb2',
        surface: {
          DEFAULT: '#131313',
          dim: '#131313',
          low: '#1c1b1b',
          mid: '#201f1f',
          high: '#2a2a2a',
          highest: '#353534',
          bright: '#3a3939',
        },
        onSurface: {
          DEFAULT: '#e5e2e1',
          variant: '#b9ccb2',
        },
        outline: {
          DEFAULT: '#84967e',
          variant: '#3b4b37',
        },
        error: {
          DEFAULT: '#ffb4ab',
          container: '#93000a',
        },
        // Severity colors
        severity: {
          critical: '#ff4444',
          high: '#ff8c00',
          medium: '#ffbb33',
          low: '#4fc3f7',
          info: '#84967e',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};

export default config;
