import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');

    return {
        envDir: '..',
        resolve: {
            alias: {
                '@': '/src',
                '@social/shared': new URL('../packages/shared/src', import.meta.url).pathname,
            },
        },
        plugins: [
            react(),
            tailwindcss(),
        ],
        server: {
            proxy: {
                '/api': {
                    target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api/, '')
                },
                '/ws': {
                    target: env.VITE_WS_PROXY_TARGET || 'ws://localhost:8080',
                    ws: true
                },
                '/notifications-api': {
                    target: env.VITE_NOTIFICATIONS_PROXY_TARGET || 'http://localhost:8085',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/notifications-api/, '')
                }
            }
        }
    };
})
