/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        surface: '#0f1115',
        'surface-muted': '#13141f',
        'surface-panel': 'rgba(17, 18, 30, 0.95)'
      }
    }
  },
  plugins: []
};
