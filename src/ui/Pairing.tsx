// Pairing widgets: show a code (QR + text) and read a code (camera or paste).

import { useEffect, useRef, useState } from 'preact/hooks';
import { copyBox } from './Dialogs';
import { qrSvg, startScanner } from '../transport/qr';
import { createOffer, acceptAnswer, answerOffer, describeReachability, describeProgress, watchConnection, type ConnectionProgress, type Reachability } from '../transport/webrtc';
import type { Transport } from '../transport/transport';
export function ShowCode({ code, caption }: { code: string; caption: string }) {
  const [copied, setCopied] = useState(false);
  const svg = qrSvg(code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      copyBox({
        title: 'Copy this code',
        body: 'Select the text and copy it, then send it to the other device.',
        value: code,
      });
    }
  };
  return (
    <div class="show-code">
      <div
        class="qr"
        dangerouslySetInnerHTML={{
          __html: svg,
        }}
      />
      <p class="muted">{caption}</p>
      <div class="code-text">
        <textarea readOnly rows={3} onFocus={(e) => e.currentTarget.select()} value={code} />
        <button class="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy text code'}
        </button>
      </div>
    </div>
  );
}
export function ReadCode({ onCode, prompt }: { onCode: (code: string) => void | Promise<void>; prompt: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'camera' | 'paste'>('camera');
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (mode !== 'camera' || !video.current) return;
    let stop = () => {};
    let alive = true;
    startScanner(
      video.current,
      (c) => alive && onCode(c),
      (e) => {
        setErr(e.message);
        setMode('paste');
      },
    ).then((s) => {
      stop = s;
      if (!alive) s();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [mode]);
  return (
    <div class="read-code">
      <p>{prompt}</p>
      <div class="seg">
        <button class={`btn ${mode === 'camera' ? 'on' : 'ghost'}`} onClick={() => setMode('camera')}>
          Scan with camera
        </button>
        <button class={`btn ${mode === 'paste' ? 'on' : 'ghost'}`} onClick={() => setMode('paste')}>
          Paste text code
        </button>
      </div>
      {err ? <p class="error">{err}</p> : null}
      {mode === 'camera' ? (
        <div class="scanner">
          <video ref={video} playsinline muted />
          <div class="scan-frame" />
        </div>
      ) : (
        <form
          class="paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onCode(text.trim());
          }}
        >
          <textarea rows={4} placeholder="MTG1…" value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <button class="btn primary" type="submit">
            Use this code
          </button>
        </form>
      )}
    </div>
  );
}

/** How this device's code says it can be reached; a warning when only hidden names are offered. */
function ReachNote({ reach }: { reach: Reachability }) {
  return (
    <p class={`muted small reach ${reach.direct || reach.relay ? '' : 'warn'}`}>
      This code offers {describeReachability(reach)}.
      {reach.direct || reach.relay ? null : ' The other device may not find this one: allow the camera when asked, connect both to the same Wi-Fi network, or connect to the internet for the relay.'}
    </p>
  );
}

/** Live progress while the two devices try to reach each other (for diagnosing pairing). */
function useProgress(pc: RTCPeerConnection | null): ConnectionProgress | null {
  const [p, setP] = useState<ConnectionProgress | null>(null);
  useEffect(() => (pc ? watchConnection(pc, setP) : undefined), [pc]);
  return p;
}

// ---------- Pairing flows (shared by first pairing and re-pairing) ----------

const errText = (e: unknown) => String((e as Error | null)?.message || e);

/** Host: create an offer code, then read the guest's answer. */
export function HostPairFlow({ onTransport }: { onTransport: (t: Transport) => void | Promise<void> }) {
  const [step, setStep] = useState<'start' | 'working' | 'offer' | 'scan' | 'connecting'>('start');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const offer = useRef<Awaited<ReturnType<typeof createOffer>> | null>(null);
  const [watching, setWatching] = useState<RTCPeerConnection | null>(null);
  const progress = useProgress(watching);
  const begin = async (camera: boolean) => {
    setErr('');
    setStep('working');
    try {
      offer.current = await createOffer(camera);
      setCode(offer.current.code);
      setStep('offer');
    } catch (e) { setErr(errText(e)); setStep('start'); }
  };
  const onAnswer = async (ans: string) => {
    setStep('connecting'); setErr('');
    setWatching(offer.current!.pc);
    try { await onTransport(await acceptAnswer(offer.current!.pc, offer.current!.dc, ans)); }
    catch (e) { setErr(errText(e)); setStep('scan'); }
    finally { setWatching(null); }
  };
  return (
    <div class="pair">
      {err ? <p class="error">{err}</p> : null}
      {step === 'start' ? (
        <div class="pair-step">
          <p>Both devices must be on the same Wi-Fi. No internet is needed. A hotspot works only from a third device that isn't playing.</p>
          <p class="muted small">The app asks for the camera first: you need it to scan the guest's code, and it also lets the two devices find each other directly on the local network.</p>
          <button class="btn primary" onClick={() => void begin(true)}>Allow camera and create code</button>
          <button class="btn ghost" onClick={() => void begin(false)}>Create code without camera (text pairing)</button>
        </div>
      ) : null}
      {step === 'working' ? <p>Creating pairing code…</p> : null}
      {step === 'offer' ? (
        <div class="pair-step">
          <h3>1. On the guest device, choose Join and scan this code</h3>
          <ShowCode code={code} caption="Or copy the text code and paste it on the guest." />
          {offer.current ? <ReachNote reach={offer.current.reach} /> : null}
          <button class="btn primary" onClick={() => setStep('scan')}>2. Next: scan the guest's code</button>
        </div>
      ) : null}
      {step === 'scan' ? (
        <div class="pair-step">
          <h3>2. Scan the code now showing on the guest device</h3>
          <ReadCode onCode={onAnswer} prompt="Point the camera at the guest's screen, or paste its text code." />
          <button class="btn ghost" onClick={() => setStep('offer')}>Back to my code</button>
        </div>
      ) : null}
      {step === 'connecting' ? <p>Connecting…{progress ? <span class="muted small progress"> ({describeProgress(progress)})</span> : null}</p> : null}
    </div>
  );
}

/** Guest: read the host's offer code, then show the answer code. */
export function GuestPairFlow({ onTransport }: { onTransport: (t: Transport) => void | Promise<void> }) {
  const [step, setStep] = useState<'scan' | 'working' | 'answer'>('scan');
  const [code, setCode] = useState('');
  const [reach, setReach] = useState<Reachability | null>(null);
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const progress = useProgress(pc);
  const [err, setErr] = useState('');
  const onOffer = async (offerCode: string) => {
    setErr(''); setStep('working');
    try {
      const a = await answerOffer(offerCode);
      setCode(a.code);
      setReach(a.reach);
      setPc(a.pc);
      setStep('answer');
      await onTransport(await a.transport);
    } catch (e) { setErr(errText(e)); setStep('scan'); }
    finally { setPc(null); }
  };
  return (
    <div class="pair">
      {err ? <p class="error">{err}</p> : null}
      {step === 'scan' ? (
        <div class="pair-step">
          <h3>1. Scan the code on the host device</h3>
          <ReadCode onCode={onOffer} prompt="Both devices must be on the same Wi-Fi (a hotspot only from a third device)." />
        </div>
      ) : null}
      {step === 'working' ? <p>Reading code…</p> : null}
      {step === 'answer' ? (
        <div class="pair-step">
          <h3>2. Show this code to the host device</h3>
          <ShowCode code={code} caption="The host scans it (or pastes the text). This screen continues once connected." />
          {reach ? <ReachNote reach={reach} /> : null}
          {progress ? <p class="muted small progress">Waiting for the host: {describeProgress(progress)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
