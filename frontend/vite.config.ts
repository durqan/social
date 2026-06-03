import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    envDir: '..',
    resolve: {
        alias: {
            '@': '/src',
        },
    },
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            },
            '/ws': {
                target: 'ws://localhost:8080',
                ws: true
            },
            '/notifications-api': {
                target: 'http://localhost:8085',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/notifications-api/, '')
            }
        }
    }
})
