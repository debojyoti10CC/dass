import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { LandingPage } from './LandingPage'
import './styles.css'

const App = lazy(() => import('./App').then(module => ({ default: module.App })))
const marketsView = new URLSearchParams(location.search).get('view') === 'markets'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {marketsView ? <Suspense fallback={<p role="status">Loading markets…</p>}><App /></Suspense> : <LandingPage />}
  </StrictMode>,
)
