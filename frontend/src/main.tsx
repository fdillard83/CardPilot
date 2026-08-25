import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PublicPage } from './legal/PublicPage.tsx'
import { appearanceCacheKey } from './accounts/preferences.ts'

const savedAppearance = window.localStorage.getItem(appearanceCacheKey)
const appearance = savedAppearance === 'light' || savedAppearance === 'system' ? savedAppearance : 'dark'
const resolvedAppearance = appearance === 'system'
  ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  : appearance
document.documentElement.dataset.theme = resolvedAppearance
document.documentElement.style.colorScheme = resolvedAppearance

const publicPath = window.location.pathname.replace(/\/+$/, '') || '/'
const content = publicPath === '/about' || publicPath === '/privacy'
  ? <PublicPage page={publicPath === '/privacy' ? 'privacy' : 'about'} />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {content}
  </StrictMode>,
)
