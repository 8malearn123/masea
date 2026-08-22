/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // أزرق الماسة (primary) — from the customer experience design system
        navy: {
          DEFAULT: '#1f58a8',
          50: '#f3f6fb',
          100: '#e3e9f2',
          200: '#cbd3df',
          600: '#1f58a8',
          700: '#16407c',
          800: '#14294a',
          900: '#0e1a2b',
        },
        // ذهبي
        gold: { DEFAULT: '#c9a24a', 100: '#fbefdd', 500: '#e8b23a', 600: '#9a6212' },
        // رمادي أزرق بارد للنصوص الثانوية
        purple: { DEFAULT: '#65738c', 100: '#e8ecf3' },
        // أخضر التوفّر (success / secondary accent)
        teal: { DEFAULT: '#2e9e5b', 100: '#e5f4ec' },
        // واجهة العميل — منسجمة مع نظام أزرق الماسة
        brand: { DEFAULT: '#1f58a8', dark: '#14294a', accent: '#c9a24a', 50: '#f3f6fb', 100: '#e3e9f2' },
      },
      fontFamily: {
        sans: ['Alexandria', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: { card: '0 1px 3px rgba(31,88,168,0.10), 0 1px 2px rgba(31,88,168,0.06)' },
    },
  },
  plugins: [],
};
