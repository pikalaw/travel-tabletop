// QR codes: render a pairing code as SVG, and scan one from the camera.

import { encode } from 'uqr';
import jsQR from 'jsqr';

/** SVG markup for a QR code of `text`. */
export function qrSvg(text) {
  const { data, size } = encode(text, { ecc: 'L', border: 2 });
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/**
 * Start scanning with the rear camera into `video`. Calls onCode(text) once with the first
 * code found. Returns a stop() function.
 */
export async function startScanner(video, onCode, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    onError?.(new Error('Camera unavailable. Paste the code as text instead.'));
    return () => {};
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let raf = 0;
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit?.data && hit.data.startsWith('MTG1')) { stop(); onCode(hit.data); return; }
    }
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
