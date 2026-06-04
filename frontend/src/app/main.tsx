import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeTheme } from '@/app/themes/theme-storage.js'
import './index.css'
import App from './App.js'

initializeTheme()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Failed to find the root element')

createRoot(rootElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
