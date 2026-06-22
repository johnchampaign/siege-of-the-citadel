import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { OnlineGame } from './ui/OnlineGame';
import { AssetProvider } from './ui/assets';
import { readOnlineParams } from './ui/api';
import { UpdateBanner } from 'digital-boardgame-framework/client';

document.body.style.margin = '0';
document.body.style.background = '#161616';

const online = readOnlineParams();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AssetProvider>
      {/* Shows a "new version — Reload" bar once a newer build is deployed. */}
      <UpdateBanner currentBuild={__DBF_BUILD_ID__} reloadLabel="Reload" />
      {online ? <OnlineGame params={online} /> : <App />}
    </AssetProvider>
  </React.StrictMode>,
);
