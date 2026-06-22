import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { OnlineGame } from './ui/OnlineGame';
import { AssetProvider } from './ui/assets';
import { readOnlineParams } from './ui/api';

document.body.style.margin = '0';
document.body.style.background = '#161616';

const online = readOnlineParams();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AssetProvider>
      {online ? <OnlineGame params={online} /> : <App />}
    </AssetProvider>
  </React.StrictMode>,
);
