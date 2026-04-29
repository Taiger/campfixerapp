/** @type {import('tailwindcss').Config} */
module.exports = {
  // Toggle dark mode by adding/removing the 'dark' class on <html>.
  darkMode: 'class',

  // Tailwind scans these files to know which utility classes to include in the build.
  content: ['./index.html', './src/**/*.js'],

  theme: {
    extend: {
      colors: {
        'dark-moss':    '#1A1C14',
        'forest-green': '#2C4A3E',
        'sage-green':   '#4A9B5A',
        'camp-amber':   '#D4891A',
        'ember-red':    '#C0392B',
        'aged-paper':   '#F5F0E8',
        'off-white':    '#F8F4EC',
      },
      fontFamily: {
        'display': ['Nunito', 'system-ui', 'sans-serif'],
        'body':    ['Nunito', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        fadeSlideIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' }
        },
        sinkOut: {
          from: { opacity: '1', transform: 'translateY(0)' },
          to:   { opacity: '0.4', transform: 'translateY(4px)' }
        },
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' }
        },
        slideDown: {
          from: { transform: 'translateY(0)' },
          to:   { transform: 'translateY(100%)' }
        },
      },
      animation: {
        'fade-in':    'fadeSlideIn 0.25s ease forwards',
        'slide-up':   'slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards',
      }
    }
  }
};
