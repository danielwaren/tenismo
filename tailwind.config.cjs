const hsl = (v) => `hsl(${v})`;
const withVar = (name) => ({ opacityValue } = {}) =>
  opacityValue === undefined ? `hsl(var(${name}))` : `hsl(var(${name}) / ${opacityValue})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens semánticos (definidos en global.css). Un color = un significado.
        bg: withVar('--bg'),
        surface: { DEFAULT: withVar('--surface'), 2: withVar('--surface-2') },
        line: withVar('--line'),
        ink: { DEFAULT: withVar('--ink'), muted: withVar('--ink-muted'), faint: withVar('--ink-faint') },
        court: { DEFAULT: withVar('--court'), ink: withVar('--court-ink') },
        live: withVar('--live'),
        // Colores de superficie de pista, para las etiquetas.
        clay: '#d1743a',
        grass: '#4aa564',
        hard: '#4d8bf0',
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Escala tipográfica consistente.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
        'pulse-live': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
      },
      animation: {
        'fade-up': 'fade-up 240ms ease-out both',
        'pulse-live': 'pulse-live 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
