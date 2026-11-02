// Pairing widgets: show a code (QR + text) and read a code (camera or paste).

import { html, useEffect, useRef, useState } from './h.js';
import { qrSvg } from '../transport/qr.js';
import { startScanner } from '../transport/qr.js';

export function ShowCode({ code, caption }) {
  const [copied, setCopied] = useState(false);
  const svg = qrSvg(code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt('Copy this code:', code); }
  };
  return html`<div class="show-code">
    <div class="qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>
    <p class="muted">${caption}</p>
    <div class="code-text">
      <textarea readonly rows="3" onFocus=${(e) => e.currentTarget.select()}>${code}</textarea>
      <button class="btn" onClick=${copy}>${copied ? 'Copied' : 'Copy text code'}</button>
    </div>
  </div>`;
}

export function ReadCode({ onCode, prompt }) {
  const video = useRef(null);
  const [mode, setMode] = useState('camera');
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (mode !== 'camera' || !video.current) return;
    let stop = () => {};
    let alive = true;
    startScanner(video.current, (c) => alive && onCode(c), (e) => { setErr(e.message); setMode('paste'); }).then((s) => { stop = s; if (!alive) s(); });
    return () => { alive = false; stop(); };
  }, [mode]);
  return html`<div class="read-code">
    <p>${prompt}</p>
    <div class="seg">
      <button class="btn ${mode === 'camera' ? 'on' : 'ghost'}" onClick=${() => setMode('camera')}>Scan with camera</button>
      <button class="btn ${mode === 'paste' ? 'on' : 'ghost'}" onClick=${() => setMode('paste')}>Paste text code</button>
    </div>
    ${err ? html`<p class="error">${err}</p>` : null}
    ${mode === 'camera'
      ? html`<div class="scanner"><video ref=${video} playsinline muted></video><div class="scan-frame"></div></div>`
      : html`<form class="paste" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) onCode(text.trim()); }}>
          <textarea rows="4" placeholder="MTG1…" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
          <button class="btn primary" type="submit">Use this code</button>
        </form>`}
  </div>`;
}
