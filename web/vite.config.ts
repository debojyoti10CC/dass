import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [
        { name: 'react', test: /node_modules[\\/]react/, priority: 20 },
        { name: 'wallet', test: /node_modules[\\/](viem|abitype|ox|@noble|@scure)/, priority: 10 },
      ] } },
    },
  },
})
