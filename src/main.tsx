import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initMonitoring } from './lib/monitoring';

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found');
initMonitoring();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
