import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PublicPage } from './legal/PublicPage.tsx'

const publicPath = window.location.pathname.replace(/\/+$/, '') || '/'
const content = publicPath === '/about' || publicPath === '/privacy'
  ? <PublicPage page={publicPath === '/privacy' ? 'privacy' : 'about'} />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {content}
  </StrictMode>,
)
