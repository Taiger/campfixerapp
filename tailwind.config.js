/** @type {import('tailwindcss').Config} */
module.exports = {
  // Toggle dark mode by adding/removing the 'dark' class on <html>.
  darkMode: 'class',

  // Tailwind scans these files to know which utility classes to include in the build.
  // If you add a new .js file that generates class names, add it here.
  content: ['./index.html', './src/**/*.js'],

  theme: {
    extend: {
      keyframes: {
        // Used for the fade-in animation when a new packing item is added.
        fadeSlideIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fadeSlideIn 0.25s ease forwards'
      }
    }
  }
};
