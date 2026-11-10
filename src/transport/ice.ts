// How two devices find each other beyond one local network: a public STUN server (each device
// learns its internet address) and Open Relay's free TURN relay (metered.ca) for when no direct
// route works. The local network is still tried first: ICE prefers direct addresses, so a game on
// one Wi-Fi never touches the relay. Without internet access these servers just add nothing.
//
// Open Relay's "static auth" uses the TURN REST scheme coturn implements: the username is
// "<expiry, in Unix seconds>:<any name>" and the password is base64(HMAC-SHA1(secret, username)).
// The secret is the one Open Relay publishes for static auth, so it is no secret.

const RELAY_HOST = 'staticauth.openrelay.metered.ca';
const RELAY_SECRET = 'openrelayprojectsecret';
/** How long a relay credential is valid; a game longer than this re-pairs to keep the relay. */
const RELAY_TTL_S = 24 * 3600;

const bytes = (s: string) => new TextEncoder().encode(s);

function base64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * The ICE servers for a new connection. The relay needs WebCrypto, which browsers give only to
 * secure pages (https, or localhost); elsewhere it is left out and only STUN is used.
 */
export async function iceServers(now = Date.now()): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (!globalThis.crypto?.subtle) return servers;
  const username = `${Math.floor(now / 1000) + RELAY_TTL_S}:travel-tabletop`;
  const key = await crypto.subtle.importKey('raw', bytes(RELAY_SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const credential = base64(await crypto.subtle.sign('HMAC', key, bytes(username)));
  servers.push({
    // UDP and TCP on port 80, and TLS on 443, so a network that blocks one still has another.
    urls: [`turn:${RELAY_HOST}:80`, `turn:${RELAY_HOST}:80?transport=tcp`, `turns:${RELAY_HOST}:443?transport=tcp`],
    username,
    credential,
  });
  return servers;
}
