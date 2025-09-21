/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary Green Palette
        'green-primary': '#10B981',
        'eco-mint': '#6EE7B7',
        'leaf-green': '#16A34A',
        'forest-green': '#15803D',

        // Earth Tones
        'earth-brown': '#92400E',
        'sand-beige': '#FEF3C7',
        'clay-orange': '#EA580C',

        // Sky & Water
        'sky-blue': '#0EA5E9',
        'ocean-blue': '#0369A1',
        'cloud-gray': '#E5E7EB',

        // Sustainability Indicators
        'sustainable-gold': '#FBBF24',
        'eco-success': '#10B981',
        'eco-warning': '#F59E0B',
        'eco-danger': '#EF4444',
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'display': ['Poppins', 'sans-serif'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      boxShadow: {
        'eco': '0 4px 6px -1px rgba(16, 185, 129, 0.1), 0 2px 4px -1px rgba(16, 185, 129, 0.06)',
        'eco-lg': '0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -2px rgba(16, 185, 129, 0.05)',
      },
    },
  },
  plugins: [],
}