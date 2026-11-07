import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/saira-condensed/latin-500.css'
import '@fontsource/saira-condensed/latin-600.css'
import '@fontsource/saira-condensed/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'

import './styles/app.css'
import './styles/theme.css'
import './styles/layout.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
