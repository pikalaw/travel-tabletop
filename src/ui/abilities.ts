// A card's abilities, as the full view offers them: the Oracle paragraphs of the face that is up.
// Scryfall has no structured list of abilities; its oracle_text separates paragraphs with "\n".
// Lines are not classified (activated, triggered, static): every one is offered, the player picks.

import type { CardText } from '../types/storage';

/** One face's offered lines, under the face's name when the card shows several faces at once. */
export interface AbilityGroup {
  face: string | null;
  lines: string[];
}

/**
 * Split Oracle text into abilities. A line starting with "•" is a mode of the line above it
 * ("Choose one —"), so it joins that line; every other line is its own ability, reminder text
 * and keyword lists ("Flying, vigilance") included.
 */
export function abilityLines(oracleText: string): string[] {
  const out: string[] = [];
  for (const raw of oracleText.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('•') && out.length) out[out.length - 1] += `\n${line}`;
    else out.push(line);
  }
  return out;
}

/**
 * The abilities to offer for a card showing `face`. A double-faced card (one with a back image)
 * offers only the face that is up; a card whose faces share one side (split, adventure, flip)
 * offers every face, each under its name.
 */
export function abilitiesOf(text: CardText | undefined, face: 'front' | 'back', doubleFaced: boolean): AbilityGroup[] {
  if (!text?.faces.length) return [];
  const faces = doubleFaced ? [text.faces[face === 'back' ? 1 : 0] ?? text.faces[0]!] : text.faces;
  const named = faces.length > 1;
  return faces
    .map((f) => ({ face: named ? f.name : null, lines: abilityLines(f.oracleText) }))
    .filter((g) => g.lines.length);
}
