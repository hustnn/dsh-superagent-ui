import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { exchangeToken } from './api'
import { App } from './App'
import './styles.css'

// A launch link carries `?token=`; trade it for the session cookie before anything else talks to the BFF.
const token = await exchangeToken()
createRoot(document.getElementById('root')!).render(<StrictMode><App tokenRefused={token === 'refused'} /></StrictMode>)
