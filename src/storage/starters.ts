// Built-in decklists that download on demand. Only the lists ship with the app; card images
// come from Scryfall at download time.
//
// Avatar: The Last Airbender Beginner Box: ten 20-card decks, as published by Wizards of the Coast:
// https://magic.wizards.com/en/news/announcements/avatar-the-last-airbender-beginner-box-contents
// The page gives counts only for basic lands; every other card is one copy (each list totals 20).
// Lines carry the set code (TLA) to prefer the Avatar printing; the importer falls back to a
// name-only match when a card is not in that set.

const raw: Record<string, string> = {
  'Aang Tutorial': `8 Plains
Aardvark Sloth
Razor Rings
Path to Redemption
Appa, Aang's Companion
Sledding Otter-Penguin
Aang, Air Nomad
Katara, Heroic Healer
Momo, Rambunctious Rascal
Aang's Defense
Sokka, Wolf Cove's Protector
Tundra Wall
Wolf Cove Villager`,
  'Zuko Tutorial': `8 Mountain
Dragon Moose
Explosive Shot
Run Amok
Fire Nation's Conquest
Komodo Rhino
Zuko, Avatar Hunter
Zhao, the Seething Flame
Iroh, Firebending Instructor
Zuko's Offense
Fire Nation Soldier
Capital Guard
Warship Scout`,
  Allies: `7 Plains
Kyoshi Warrior Guard
Jeong Jeong's Deserters
Glider Kids
Avatar Enthusiasts
Allied Teamwork
Aang, the Last Airbender
Suki, Kyoshi Warrior
Rabaroo Troop
Master Piandao
Mechanical Glider
Path to Redemption
Airbending Lesson
Thriving Heath`,
  Waterbending: `7 Island
Flying Dolphin-Fish
Otter-Penguin
Katara, Bending Prodigy
Sokka, Lateral Strategist
Cat-Owl
Flexible Waterbender
Giant Koi
The Terror of Serpent's Pass
Watery Grasp
Bender's Waterskin
Deny Entry
Waterbending Lesson
Thriving Isle`,
  Spells: `7 Island
First-Time Flyer
Master Pakku
Rowdy Snowballers
Iguana Parrot
Turtle-Seals
Geyser Leaper
Serpent of the Pass
Barrels of Blasting Jelly
Abandon Attachments
It'll Quench Ya!
Lost in the Spirit World
Water Whip
Thriving Isle`,
  Attacking: `7 Swamp
Purple Pentapus
Corrupt Court Official
Merchant of Many Hats
Pretending Poxbearers
Fire Nation Ambushers
Hei Bai, Spirit of Balance
Lion Vulture
Beetle-Headed Merchants
Cat-gator
Heartless Act
Epic Downfall
Dai Li Indoctrination
Thriving Moor`,
  Counters: `7 Swamp
Gilacorn
Elephant-Rat
Long Feng, Grand Secretariat
Dai Li Indoctrination
Fire Nation Engineer
Earth Village Ruffians
Hog-Monkey
Buzzard-Wasp Colony
Fire Nation Sentinels
Azula Always Lies
Feed the Swarm
Ozai's Cruelty
Thriving Moor`,
  Firebending: `7 Mountain
Deserter's Disciple
Fire Sages
Yuyan Archers
Vindictive Warden
Loyal Fire Sage
Zuko, Exiled Prince
Fire Nation Archers
Rough Rhino Cavalry
Mongoose Lizard
Lightning Strike
How to Start a Riot
Roku's Mastery
Thriving Bluff`,
  'Big Creatures': `7 Forest
Turtle-Duck
Raucous Audience
Frog-Squirrels
Ostrich-Horse
Match the Odds
Eel-Hounds
Hippo-Cows
Saber-Tooth Moose-Lion
Flopsie, Bumi's Buddy
Mechanical Glider
Hog-Monkey Rampage
Seismic Tutelage
Thriving Grove`,
  Earthbending: `7 Forest
Rebellious Captives
Haru, Hidden Talent
Earth Village Ruffians
Toph, the Blind Bandit
Earth Kingdom Soldier
Earthbending Lesson
Badgermole
Bumi, Eclectic Earthbender
Rocky Rebuke
Explore
Pillar Launch
Earth Rumble
Thriving Grove`,
};

/** Add "1 " to unnumbered lines and the set code to every line. */
function withSet(text: string, set: string): string {
  return text.split('\n').map((l) => {
    const line = /^\d/.test(l) ? l : `1 ${l}`;
    return `${line} (${set})`;
  }).join('\n');
}

export interface StarterPack {
  id: string;
  name: string;
  blurb: string;
  tokens: { id: string; name: string };
  decks: { starterId: string; name: string; text: string }[];
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'tla-beginner-box',
    name: 'Avatar: The Last Airbender Beginner Box',
    blurb: '10 decks of 20 cards, plus the tokens they create. Two are tutorial decks; the other eight are themes meant to be combined two at a time.',
    tokens: { id: 'tla-bb-tokens', name: 'Avatar BB: Tokens' },
    decks: Object.entries(raw).map(([name, text]) => ({
      starterId: `tla-bb-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: `Avatar BB: ${name}`,
      text: withSet(text, 'TLA'),
    })),
  },
];
