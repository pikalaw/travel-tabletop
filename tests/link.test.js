import { describe, it, expect } from 'vitest';
import { newGameId, parseGameLink } from '../src/ui/link.js';

describe('game links', () => {
  it('ids carry the date and 80 random bits, and do not repeat', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newGameId(new Date('2026-11-02T12:00:00Z'))));
    expect(ids.size).toBe(5000);
    for (const id of ids) expect(id).toMatch(/^2026-11-02-[0-9a-hjkmnp-tv-z]{16}$/);
  });
  it('parses only well-formed game links', () => {
    expect(parseGameLink('#game=2026-11-02-abcdefghjkmnpqrs')).toBe('2026-11-02-abcdefghjkmnpqrs');
    expect(parseGameLink('#game=2026-10-30-k3j9xa')).toBe('2026-10-30-k3j9xa'); // ids made before this change
    expect(parseGameLink('')).toBeNull();
    expect(parseGameLink('#game=')).toBeNull();
    expect(parseGameLink('#game=<script>')).toBeNull();
    expect(parseGameLink('#decks')).toBeNull();
  });
});
