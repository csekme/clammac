import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

// follow the OS appearance
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.classList.toggle('dark', mq.matches)
}
applyTheme()
mq.addEventListener('change', applyTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
