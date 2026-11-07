import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import './styles.css';
import App from './App';
import { initTelegram } from './tg';

initTelegram();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
