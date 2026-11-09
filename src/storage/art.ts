// Card images as object URLs, in every stored size, for drawing.

import { getDefs, getImage } from './db';
import type { CardText } from '../types/storage';

export type ImageSize = 'small' | 'normal' | 'large';
export type FaceUrls = Record<ImageSize, string | null>;

/** Resolved image URLs for one card definition. */
export interface Art {
  name: string;
  front: string | null;
  back: string | null;
  sizes: { front: FaceUrls; back: FaceUrls | null };
  /** Rules text, for the abilities list (missing on sample cards and older imports). */
  text?: CardText;
}

const urlCache = new Map<string, string>();

export async function imageUrl(hash: string | null | undefined): Promise<string | null> {
  if (!hash) return null;
  const hit = urlCache.get(hash);
  if (hit) return hit;
  const rec = await getImage(hash);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(hash, url);
  return url;
}

/**
 * Resolve image URLs for a set of card definitions, in every stored size. `front` and `back`
 * are the normal size; small and large fall back to normal when missing (sample cards are SVG
 * and scale, and decks imported before sizes existed have one size).
 */
export async function loadArt(defIds: readonly string[]): Promise<Map<string, Art>> {
  const defs = await getDefs(defIds);
  const out = new Map<string, Art>();
  for (const def of defs) {
    const front = await imageUrl(def.front);
    const back = def.back ? await imageUrl(def.back) : null;
    const face = async (normal: string | null, extra?: { small: string; large: string } | null): Promise<FaceUrls> => ({
      small: (extra?.small && (await imageUrl(extra.small))) || normal,
      normal,
      large: (extra?.large && (await imageUrl(extra.large))) || normal,
    });
    out.set(def.id, {
      name: def.name, front, back,
      sizes: { front: await face(front, def.sizes?.front), back: back ? await face(back, def.sizes?.back) : null },
      ...(def.text ? { text: def.text } : {}),
    });
  }
  return out;
}

/** Choose an image size for a card drawn `cssHeight` CSS pixels tall on this screen. */
export function sizeFor(cssHeight: number, dpr: number = globalThis.devicePixelRatio || 1): ImageSize {
  const px = cssHeight * dpr;
  if (px <= 230) return 'small';   // small is 204 px tall
  if (px <= 720) return 'normal';  // normal is 680 px tall
  return 'large';                  // large is 936 px tall
}

/** URL of one face of a card at a size, with fallbacks. */
export function artUrl(art: Art | null | undefined, face: 'front' | 'back', size: ImageSize): string | null {
  if (!art) return null;
  const set = face === 'back' ? art.sizes.back : art.sizes.front;
  return set?.[size] || (face === 'back' ? art.back : art.front) || null;
}
