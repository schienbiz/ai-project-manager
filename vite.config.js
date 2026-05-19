import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/pm',
  server: {
    port: 5174,
    proxy: {
      '/pm/api': 'http://localhost:3004',
    },
  },
})
