import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <p className="eyebrow">Arc Testnet · Project starter</p>
      <h1>Distribution Markets</h1>
      <p className="intro">Trade a forecast for an outcome and its uncertainty.</p>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Project setup is ready</h2>
        <p>The application scaffold is running. Forecast editing, wallet connections,
          and settlement will follow the mechanism and contract verification phases.</p>
        <dl>
          <dt>Frontend</dt><dd>React + TypeScript + Vite</dd>
          <dt>Planned network</dt><dd>Arc Testnet · 5042002</dd>
          <dt>Next phase</dt><dd>Verify curve math and collateral accounting</dd>
        </dl>
      </section>
      <p className="note">This starter does not accept deposits or send transactions.</p>
    </main>
  </StrictMode>,
)
