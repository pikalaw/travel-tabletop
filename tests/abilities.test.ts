// Ability lines from Oracle text: modal joins, keywords, reminder text, and which faces count.
import { describe, expect, it } from 'vitest';
import { abilityLines, abilitiesOf } from '../src/ui/abilities';
import type { CardText } from '../src/types/storage';

const face = (name: string, oracleText: string) => ({ name, typeLine: 'Creature', oracleText });
const text = (...faces: ReturnType<typeof face>[]): CardText => ({ faces, record: {} });

describe('ability lines', () => {
  it('one ability per paragraph; reminder text and keyword lists stay on their line', () => {
    // Serra Angel
    expect(abilityLines('Flying, vigilance')).toEqual(['Flying, vigilance']);
    // Llanowar Elves
    expect(abilityLines('{T}: Add {G}.')).toEqual(['{T}: Add {G}.']);
    // Fire Sages-style keyword with reminder text, then an activated ability
    expect(abilityLines('Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)\n{1}{R}: This creature gets +1/+0 until end of turn.'))
      .toEqual([
        'Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)',
        '{1}{R}: This creature gets +1/+0 until end of turn.',
      ]);
  });

  it('modes join the line that offers them', () => {
    // Abrade
    const t = 'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.';
    expect(abilityLines(t)).toEqual([t]);
    // a modal ability after another ability
    expect(abilityLines('Flying\nWhen this enters, choose one —\n• Draw a card.\n• Scry 2.'))
      .toEqual(['Flying', 'When this enters, choose one —\n• Draw a card.\n• Scry 2.']);
  });

  it('blank lines and stray spaces are dropped; no text, no abilities', () => {
    expect(abilityLines('  Haste \n\n')).toEqual(['Haste']);
    expect(abilityLines('')).toEqual([]);
  });

  it('a double-faced card offers the face that is up; split and adventure cards offer every face, named', () => {
    const dfc = text(face('Delver of Secrets', 'At the beginning of your upkeep, look at the top card of your library.'), face('Insectile Aberration', 'Flying'));
    expect(abilitiesOf(dfc, 'front', true)).toEqual([{ face: null, lines: ['At the beginning of your upkeep, look at the top card of your library.'] }]);
    expect(abilitiesOf(dfc, 'back', true)).toEqual([{ face: null, lines: ['Flying'] }]);
    const adventure = text(face('Bonecrusher Giant', 'Whenever this creature becomes the target of a spell, it deals 2 damage to that spell’s controller.'), face('Stomp', 'Damage can’t be prevented this turn. Stomp deals 2 damage to any target.'));
    expect(abilitiesOf(adventure, 'front', false).map((g) => g.face)).toEqual(['Bonecrusher Giant', 'Stomp']);
    // a vanilla face offers nothing; no text at all (sample cards) offers nothing
    expect(abilitiesOf(text(face('Grizzly Bears', '')), 'front', false)).toEqual([]);
    expect(abilitiesOf(undefined, 'front', false)).toEqual([]);
  });
});
