import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { unzip } from 'fflate';

// ---------------------------------------------------------------------------
// Client-side asset loader.
//
// This project ships NO game artwork. The original Mutant Chronicles board
// tiles and figure counters are copyrighted. Instead, the player downloads the
// community VASSAL module themselves, and we extract the images they need from
// THEIR copy, entirely in the browser. Extracted images are cached in
// IndexedDB so the import is a one-time step. Until a module is loaded, the
// game renders with generated placeholder tokens and is fully playable.
// ---------------------------------------------------------------------------

export const VASSAL_MODULE_URL =
  'https://obj.vassalengine.org/images/6/6f/Mutantchronicles_2.0.vmod';
export const VASSAL_MODULE_PAGE =
  'https://vassalengine.org/wiki/Module:Mutant_Chronicles:_Siege_of_the_Citadel';

// Image filenames we use, as stored under `images/` inside the .vmod zip.
const TOKEN_FILES = [
  'valerieduval.png', 'steiner.png', 'murdoch.png', 'seangallagher.png',
  'attila3.png', 'coralbeach.png', 'bigbob.png', 'hunter.png',
  'yojimbo.png', 'tatsu.png',
  'legionaire.png', 'necromutant.png', 'centurion.png', 'razide.png',
  'nepharite.png', 'ezoghoul.png',
];
const MAP_FILES = [
  'map1.jpg', 'map2.jpg', 'map3.jpg', 'map4.jpg', 'map5.jpg',
  'map6.jpg', 'map7.jpg', 'map8.jpg', 'map9.jpg', 'emptymap.jpg',
];
const WANTED = new Set([...TOKEN_FILES, ...MAP_FILES]);

// ---- IndexedDB cache (raw bytes keyed by filename) ----
const DB = 'siege-assets';
const STORE = 'images';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGetAll(): Promise<Record<string, Uint8Array>> {
  const db = await idb();
  return new Promise((res, rej) => {
    const out: Record<string, Uint8Array> = {};
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE);
    const cur = tx.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { out[c.key as string] = c.value as Uint8Array; c.continue(); }
      else res(out);
    };
    cur.onerror = () => rej(cur.error);
  });
}
async function idbPut(map: Record<string, Uint8Array>): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [k, v] of Object.entries(map)) store.put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbClear(): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function mime(name: string): string {
  return name.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

function toObjectUrls(bytes: Record<string, Uint8Array>): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [name, data] of Object.entries(bytes)) {
    const copy = new Uint8Array(data); // normalize to a plain ArrayBuffer-backed view
    urls[name] = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: mime(name) }));
  }
  return urls;
}

// ---- React context ----
interface AssetCtx {
  ready: boolean;                 // hydration from IndexedDB finished
  loaded: boolean;                // a module's images are available
  count: number;                  // how many wanted images we have
  total: number;
  error: string | null;
  importing: boolean;
  getToken: (file: string) => string | undefined;
  getMap: (file: string) => string | undefined;
  importModule: (file: File) => Promise<void>;
  clear: () => Promise<void>;
}

const Ctx = createContext<AssetCtx>(null as any);
export const useAssets = () => useContext(Ctx);

export const AssetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    idbGetAll()
      .then((bytes) => setUrls(toObjectUrls(bytes)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const importModule = useCallback(async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const wanted = await new Promise<Record<string, Uint8Array>>((res, rej) => {
        unzip(
          buf,
          {
            filter: (f) => {
              const base = f.name.split('/').pop() ?? '';
              return f.name.startsWith('images/') && WANTED.has(base);
            },
          },
          (err, data) => {
            if (err) return rej(err);
            const out: Record<string, Uint8Array> = {};
            for (const [path, bytes] of Object.entries(data)) {
              const base = path.split('/').pop()!;
              out[base] = bytes;
            }
            res(out);
          },
        );
      });
      if (Object.keys(wanted).length === 0) {
        throw new Error('No matching game images found in this file. Is it the Mutant Chronicles .vmod?');
      }
      await idbPut(wanted);
      setUrls((prev) => {
        // revoke old urls we are replacing
        for (const k of Object.keys(wanted)) if (prev[k]) URL.revokeObjectURL(prev[k]);
        return { ...prev, ...toObjectUrls(wanted) };
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      throw e;
    } finally {
      setImporting(false);
    }
  }, []);

  const clear = useCallback(async () => {
    await idbClear();
    setUrls((prev) => {
      for (const u of Object.values(prev)) URL.revokeObjectURL(u);
      return {};
    });
  }, []);

  const count = Object.keys(urls).filter((k) => WANTED.has(k)).length;

  const value: AssetCtx = {
    ready,
    loaded: count > 0,
    count,
    total: WANTED.size,
    error,
    importing,
    getToken: (f) => urls[f],
    getMap: (f) => urls[f],
    importModule,
    clear,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
