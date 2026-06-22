/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx}'],
  corePlugins: { preflight: false }, // prevent Preflight reset from overriding AI PM's dark theme
  theme: { extend: {} },
  plugins: [],
}
