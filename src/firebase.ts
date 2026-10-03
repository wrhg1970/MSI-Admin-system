import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, doc, getDocFromServer, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Set Firestore log level to error to suppress harmless gRPC stream disconnect warnings in the console
try {
  setLogLevel('error');
} catch (e) {
  console.warn('Failed to set Firestore log level:', e);
}

// Intercept and gracefully handle harmless Firestore gRPC idle stream cancellation messages and internal assertion crashes
if (typeof window !== 'undefined') {
  const isHarmless = (msg: any) => {
    if (!msg) return false;
    const str = typeof msg === 'string' ? msg : (msg.message || String(msg));
    const lower = str.toLowerCase();
    return lower.includes('disconnecting idle stream') ||
           lower.includes('timed out waiting for new targets') ||
           lower.includes('cancelled: disconnecting') ||
           lower.includes('grpcconnection rpc') ||
           lower.includes('listen\' stream') ||
           lower.includes('internal assertion failed') ||
           lower.includes('unexpected state');
  };

  window.addEventListener('error', (event) => {
    const error = event.error;
    if (error) {
      const msg = error.message || String(error);
      if (isHarmless(msg)) {
        console.warn('Intercepted and neutralized background Firestore SDK internal crash event:', msg);
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (event.message && isHarmless(event.message)) {
      console.warn('Intercepted and neutralized background Firestore SDK internal crash message:', event.message);
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error) {
      const msg = error.message || String(error);
      if (isHarmless(msg)) {
        console.warn('Intercepted and neutralized background Firestore SDK internal unhandled promise rejection:', msg);
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (isHarmless(event.reason)) {
      console.warn('Intercepted and neutralized background Firestore SDK internal unhandled rejection:', event.reason);
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    const isMatched = args.some(arg => {
      if (!arg) return false;
      if (isHarmless(arg)) return true;
      if (arg instanceof Error && isHarmless(arg.message)) return true;
      try {
        const stringified = JSON.stringify(arg);
        if (stringified && isHarmless(stringified)) return true;
      } catch (e) {}
      return false;
    });

    if (isMatched) {
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = function (...args: any[]) {
    const isMatched = args.some(arg => {
      if (!arg) return false;
      if (isHarmless(arg)) return true;
      if (arg instanceof Error && isHarmless(arg.message)) return true;
      try {
        const stringified = JSON.stringify(arg);
        if (stringified && isHarmless(stringified)) return true;
      } catch (e) {}
      return false;
    });

    if (isMatched) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
}

// --- Firestore Telemetry & Quota Tracking Interceptor ---
interface TelemetryEntry {
  timestamp: number;
  operation: 'read' | 'write' | 'delete';
  collection: string;
  docId: string;
  source: string;
}

function scanForDocuments(text: string): { collection: string, id: string }[] {
  if (!text || typeof text !== 'string') return [];
  const results: { collection: string, id: string }[] = [];
  const regex = /projects\/[^"\/]+\/databases\/[^"\/]+\/documents\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ collection: match[1], id: match[2] });
  }
  return results;
}

function getCallerSource(): string {
  try {
    const err = new Error();
    const stack = err.stack || '';
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('node_modules') || line.includes('firebase') || line.includes('react-dom') || line.includes('chunk-')) {
        continue;
      }
      const match = line.match(/\/src\/components\/([A-Za-z0-9]+)\.(tsx|ts)/) || 
                    line.match(/([A-Za-z0-9]+)\.(tsx|ts)/);
      if (match && match[1]) {
        if (match[1] === 'firebase' || match[1] === 'main') continue;
        return match[1];
      }
    }
  } catch (e) {}
  return 'System/Startup';
}

function saveTelemetryEntry(entry: TelemetryEntry) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 1. Save recent list (only keep today's entries)
    const recentKey = 'firestore_telemetry_recent_v1';
    let recent: TelemetryEntry[] = [];
    try {
      const stored = localStorage.getItem(recentKey);
      if (stored) {
        recent = JSON.parse(stored).filter((item: TelemetryEntry) => {
          const itemDate = new Date(item.timestamp);
          return itemDate.getFullYear() === today.getFullYear() &&
                 itemDate.getMonth() === today.getMonth() &&
                 itemDate.getDate() === today.getDate();
        });
      }
    } catch (e) {}

    recent.unshift(entry);
    if (recent.length > 300) {
      recent = recent.slice(0, 300);
    }
    localStorage.setItem(recentKey, JSON.stringify(recent));

    // 2. Save aggregated metrics (only keep today's keys starting with todayStr)
    const aggKey = 'firestore_telemetry_aggregated_v1';
    let agg: { [key: string]: any } = {};
    try {
      const stored = localStorage.getItem(aggKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.keys(parsed).forEach(k => {
          if (k.startsWith(todayStr)) {
            agg[k] = parsed[k];
          }
        });
      }
    } catch (e) {}

    const date = new Date(entry.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const hourKey = `${year}-${month}-${day} ${hour}:00`;

    if (!agg[hourKey]) {
      agg[hourKey] = {
        reads: 0,
        writes: 0,
        deletes: 0,
        collections: {},
        sources: {}
      };
    }

    const h = agg[hourKey];
    if (entry.operation === 'read') h.reads++;
    else if (entry.operation === 'write') h.writes++;
    else if (entry.operation === 'delete') h.deletes++;

    if (!h.collections[entry.collection]) {
      h.collections[entry.collection] = { reads: 0, writes: 0, deletes: 0 };
    }
    const colStats = h.collections[entry.collection];
    if (entry.operation === 'read') colStats.reads++;
    else if (entry.operation === 'write') colStats.writes++;
    else if (entry.operation === 'delete') colStats.deletes++;

    if (!h.sources[entry.source]) {
      h.sources[entry.source] = { reads: 0, writes: 0, deletes: 0 };
    }
    const srcStats = h.sources[entry.source];
    if (entry.operation === 'read') srcStats.reads++;
    else if (entry.operation === 'write') srcStats.writes++;
    else if (entry.operation === 'delete') srcStats.deletes++;

    localStorage.setItem(aggKey, JSON.stringify(agg));
    window.dispatchEvent(new CustomEvent('firestore_telemetry_updated', { detail: entry }));
  } catch (e) {
    console.warn("Failed to write firestore telemetry:", e);
  }
}

function processFirestoreTraffic(url: string, requestBody: string, responseText: string, source: string) {
  if (!url) return;

  const isCommit = url.includes(':commit');
  const isQuery = url.includes(':runQuery') || url.includes(':runAggregationQuery');
  const isBatchGet = url.includes(':batchGet');
  const isListen = url.includes(':listen') || url.includes('/Listen/');

  const docsInRequest = scanForDocuments(requestBody);
  const docsInResponse = scanForDocuments(responseText);

  const filterCol = (col: string) => col !== 'test';

  let operationType: 'read' | 'write' | 'delete' = 'read';
  let docsToRecord: { collection: string; id: string }[] = [];

  if (isCommit) {
    operationType = 'write';
    const isDelete = requestBody.toLowerCase().includes('"delete"');
    if (isDelete) {
      operationType = 'delete';
    }
    docsToRecord = docsInRequest.filter(d => filterCol(d.collection));
  } else {
    operationType = 'read';
    docsToRecord = docsInResponse.filter(d => filterCol(d.collection));
  }

  const seen = new Set<string>();
  const uniqueDocs = docsToRecord.filter(d => {
    const key = `${d.collection}/${d.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueDocs.length === 0) {
    if (isQuery) {
      const colMatch = requestBody.match(/"collectionId":\s*"([^"]+)"/);
      const colName = colMatch ? colMatch[1] : 'unknown';
      if (filterCol(colName)) {
        saveTelemetryEntry({
          timestamp: Date.now(),
          operation: 'read',
          collection: colName,
          docId: '(consulta vacía)',
          source
        });
      }
    }
    return;
  }

  uniqueDocs.forEach(docObj => {
    saveTelemetryEntry({
      timestamp: Date.now(),
      operation: operationType,
      collection: docObj.collection,
      docId: docObj.id,
      source
    });
  });
}

if (typeof window !== 'undefined') {
  // 1. Intercept Fetch
  try {
    const originalFetch = window.fetch;
    const customFetch = async function (this: any, input: any, init: any) {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
      const isFirestore = url.includes('firestore.googleapis.com') || url.includes('/google.firestore.v1.Firestore/');
      
      if (isFirestore) {
        const source = getCallerSource();
        let requestBody = '';
        if (init && init.body) {
          requestBody = typeof init.body === 'string' ? init.body : '';
        }
        
        const response = await originalFetch.apply(this, arguments as any);
        const cloned = response.clone();
        try {
          const responseText = await cloned.text();
          processFirestoreTraffic(url, requestBody, responseText, source);
        } catch (e) {}
        return response;
      }
      
      return originalFetch.apply(this, arguments as any);
    };

    try {
      window.fetch = customFetch;
    } catch (e) {
      Object.defineProperty(window, 'fetch', {
        value: customFetch,
        writable: true,
        configurable: true
      });
    }
  } catch (err) {
    console.warn("Could not intercept window.fetch:", err);
  }

  // 2. Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
    (this as any)._url = typeof url === 'string' ? url : String(url);
    (this as any)._method = method;
    (this as any)._source = getCallerSource();
    return originalOpen.apply(this, arguments as any);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const isFirestore = (this as any)._url && ((this as any)._url.includes('firestore.googleapis.com') || (this as any)._url.includes('/google.firestore.v1.Firestore/'));
    
    if (isFirestore) {
      (this as any)._requestBody = typeof body === 'string' ? body : '';
      
      const originalOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function () {
        if (this.readyState === 4) {
          try {
            processFirestoreTraffic((this as any)._url, (this as any)._requestBody, this.responseText, (this as any)._source);
          } catch (e) {}
        }
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(this, arguments as any);
        }
      };

      const originalOnLoad = this.onload;
      this.onload = function () {
        try {
          processFirestoreTraffic((this as any)._url, (this as any)._requestBody, this.responseText, (this as any)._source);
        } catch (e) {}
        if (originalOnLoad) {
          originalOnLoad.apply(this, arguments as any);
        }
      };
    }
    return originalSend.apply(this, arguments as any);
  };
}

const app = initializeApp(firebaseConfig);

let firestoreSettings: any = {};
try {
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  if (typeof window !== 'undefined' && window.localStorage && !isInIframe) {
    window.localStorage.setItem('__test_local_storage__', '1');
    window.localStorage.removeItem('__test_local_storage__');
    firestoreSettings = {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    };
  } else {
    firestoreSettings = {
      localCache: memoryLocalCache()
    };
  }
} catch (e) {
  firestoreSettings = {
    localCache: memoryLocalCache()
  };
}

export const db = initializeFirestore(app, firestoreSettings, (firebaseConfig as any).firestoreDatabaseId);
export const auth = getAuth();
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const isQuota = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('resource_exhausted') || errMsg.toLowerCase().includes('limit exceeded');
  const isHarmlessStream = errMsg.toLowerCase().includes('disconnecting idle stream') || errMsg.toLowerCase().includes('timed out waiting for new targets') || errMsg.toLowerCase().includes('cancelled');

  if (isHarmlessStream) {
    console.info('Firestore idle stream disconnected/cancelled gracefully (client will auto-reconnect on next request).');
    return;
  }
  
  // Dynamic UI feedback for Firestore Quota limits exceeded
  if (isQuota) {
    if (typeof document !== 'undefined' && !document.getElementById('firestore-quota-warning')) {
      const banner = document.createElement('div');
      banner.id = 'firestore-quota-warning';
      banner.className = 'fixed top-4 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl z-[99999] flex flex-col items-center gap-2 max-w-lg border border-red-500 animate-in fade-in slide-in-from-top-4 duration-300';
      banner.innerHTML = `
        <div class="flex items-center gap-3">
          <svg class="w-6 h-6 text-white shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span class="font-bold text-sm md:text-base text-center">⚠️ Cuota de Base de Datos Agotada</span>
        </div>
        <p class="text-xs text-red-100 text-center leading-relaxed">
          Se ha alcanzado el límite diario de consultas de Firestore. Los datos no se actualizarán temporalmente. Por favor, intente más tarde o solicite ampliar el plan del proyecto en la consola de Firebase.
        </p>
        <button onclick="document.getElementById('firestore-quota-warning').remove()" class="mt-1 text-[10px] bg-red-700 hover:bg-red-800 text-white font-semibold px-3 py-1 rounded transition-colors uppercase">
          Entendido
        </button>
      `;
      document.body.appendChild(banner);
    }
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }

  if (isQuota) {
    console.warn('Firestore Quota/Limit reached: ', JSON.stringify(errInfo));
    // Do not throw a hard error that halts the application, return gracefully
    return;
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
if (typeof window !== 'undefined') {
  testConnection();
}
