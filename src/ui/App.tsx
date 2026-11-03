import { APP_VERSION, BUILD_ID } from '../version';

/** Placeholder until step 3.1 brings the real shell. */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', color: '#eef2ee', background: '#0d1a15', minHeight: '100vh' }}>
      <h1>Travel Tabletop</h1>
      <p>Version 2 is being built. Build {APP_VERSION} · {BUILD_ID}</p>
    </main>
  );
}
