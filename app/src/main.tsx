import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { AssetProvider } from './ui/assets';

document.body.style.margin = '0';
document.body.style.background = '#161616';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AssetProvider>
      <App />
    </AssetProvider>
  </React.StrictMode>,
);
