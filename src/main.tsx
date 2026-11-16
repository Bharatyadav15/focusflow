import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTauriBridgeIfNeeded } from './tauriBridge';
import App from './App';
import './index.css';

initTauriBridgeIfNeeded();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
