import type { Game } from './types';

// Request wording is not evidence that a game fits. In particular, matching
// "game", "play", or "make" must never turn a miss into a recommendation.
const FILLER = new Set(`
  a an the i im id me my mine we our us you your it its this that these those
  am are is was were be been being do does did have has had can could would
  should will want wants wanted like looking look find search show give get
  please recommend suggest make create build generate let lets try need
  for of to in on at from by with as and or but about where which who when
  what how something anything game games gaming play playing playable
  one some any all each every another more really very fun cool good great
  new little just also then than into through out up down off back next
  only way much many there here other people player players person persons
`.trim().split(/\s+/));

// Small, inspectable vocabulary, not a claim of AI understanding. These are
// interchangeable words, not invented facts attached to particular games.
const WORD_GROUPS = [
  ['platform', 'platformer', 'platforming'],
  ['racing', 'race', 'racer', 'races'],
  ['rpg', 'roleplay', 'roleplaying'],
  ['roguelike', 'roguelikes'],
  ['puzzle', 'puzzler', 'puzzles'],
  ['ship', 'spaceship', 'spacecraft', 'ships', 'spaceships'],
  ['space', 'cosmic', 'outerspace'],
  ['bounce', 'bouncing', 'bounces'],
  ['jump', 'jumping', 'jumps'],
  ['fly', 'flying', 'flight'],
  ['connect', 'connecting', 'connection', 'join', 'joining'],
  ['shove', 'shoving', 'push', 'pushing', 'knock', 'knocking'],
  ['shoot', 'shooting', 'shooter'],
  ['robot', 'robots', 'bot', 'bots'],
  ['color', 'colour', 'colors', 'colours'],
  ['cooperative', 'coop', 'cooperation'],
];
const ALIASES = new Map(WORD_GROUPS.flatMap(([canonical, ...words]) =>
  [canonical, ...words].map((word) => [word, canonical] as const),
));

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonical(word: string): string {
  const alias = ALIASES.get(word);
  if (alias) return alias;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) {
    return word.slice(0, -3).replace(/([b-df-hj-np-tv-z])\1$/, '$1');
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function terms(value: string): Set<string> {
  return new Set(value
    .replace(/\brole playing\b/g, 'rpg')
    .replace(/\bco op\b/g, 'cooperative')
    .split(/\s+/)
    .filter((word) => word && !FILLER.has(word))
    .map(canonical));
}

const COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};
const COUNT = '(\\d+|one|two|three|four|five|six|seven|eight)';

function playerIntent(request: string): {
  text: string;
  accepts: (game: Game) => boolean;
  specified: boolean;
} {
  let text = request;
  let count: number | undefined;
  let multiplayer = false;
  let soloOnly = false;

  // Player counts are hard constraints. A two-player game is not a match for
  // four people, however well its description happens to match their request.
  text = text.replace(new RegExp(`\\b${COUNT} (?:players?|people|persons?|friends?|of us)\\b`, 'g'), (_match, value: string) => {
    count = COUNTS[value] ?? Number(value);
    return ' ';
  });
  text = text.replace(/\b(?:not|no|without) multiplayer\b/g, () => {
    soloOnly = true;
    return ' ';
  });
  text = text.replace(/\b(?:single player|solo|alone|by myself)\b/g, () => {
    count ??= 1;
    return ' ';
  });
  text = text.replace(/\b(?:multiplayer|multi player|with (?:my |a |some )?friends?|me and (?:my |a )?friend|together)\b/g, () => {
    multiplayer = true;
    return ' ';
  });

  return {
    text,
    specified: count !== undefined || multiplayer || soloOnly,
    accepts: (game) => (
      (count === undefined || (game.players.min <= count && game.players.max >= count))
      && (!multiplayer || game.players.max > 1)
      && (!soloOnly || game.players.max === 1)
    ),
  };
}

/**
 * Library-first request matching using only the supplied catalog. Descriptions,
 * title, genre, developer, and series supply evidence; nothing is generated or
 * fetched, and the input array and games are never changed.
 *
 * Unlike the library's blank search, an empty or generic request has no match.
 * Exact titles lead, then title phrases, then keyword coverage. Requiring most
 * of a request's meaningful words prevents "a puzzle about quantum dragons"
 * from returning every puzzle just because one generic genre overlaps.
 */
export function matchRequest(games: readonly Game[], request: string): Game[] {
  const query = normalize(request);
  if (!query) return [];
  const intent = playerIntent(query);
  const requested = terms(intent.text);
  const minimum = requested.size > 1 ? Math.max(2, Math.ceil(requested.size * 0.6)) : 1;

  return games.flatMap((game, index) => {
    if (!intent.accepts(game)) return [];

    const title = normalize(game.title);
    const exactTitle = title === query;
    const titlePhrase = title.length > 1 && ` ${query} `.includes(` ${title} `);
    // A stopword-only title can be searched exactly, but incidental words in
    // a request must not select a game called, for example, "The".
    const namedTitle = titlePhrase && terms(title).size > 0;
    if (!requested.size && !intent.specified && !exactTitle) return [];

    const fields = [
      { words: terms(title), weight: 12 },
      { words: terms(normalize(game.genre.join(' '))), weight: 8 },
      { words: terms(normalize(game.series ?? '')), weight: 8 },
      { words: terms(normalize(game.developer)), weight: 6 },
      { words: terms(normalize(game.description)), weight: 4 },
    ];
    let matched = 0;
    let score = 0;
    for (const term of requested) {
      const field = fields.find(({ words }) => words.has(term));
      if (field) {
        matched += 1;
        score += field.weight;
      }
    }
    if (requested.size && matched < minimum && !exactTitle && !namedTitle) return [];

    score += requested.size ? 100 * matched / requested.size : 0;
    if (exactTitle) score += 10_000;
    else if (namedTitle) score += 1_000;
    return [{ game, score, index }];
  }).sort((a, b) => b.score - a.score || a.game.rank - b.game.rank || a.index - b.index)
    .map(({ game }) => game);
}
