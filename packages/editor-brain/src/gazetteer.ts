/**
 * Small offline gazetteer for the map director: major cities and countries
 * with [longitude, latitude]. Anything else comes from `UnitHints.map` /
 * `places` (or, later, a geocoder): the brain never guesses coordinates.
 */
const PLACES: Record<string, [number, number]> = {
  // Cities
  'new york': [-74.006, 40.7128], 'los angeles': [-118.2437, 34.0522], chicago: [-87.6298, 41.8781], 'san francisco': [-122.4194, 37.7749], washington: [-77.0369, 38.9072],
  boston: [-71.0589, 42.3601], miami: [-80.1918, 25.7617], seattle: [-122.3321, 47.6062], houston: [-95.3698, 29.7604], 'las vegas': [-115.1398, 36.1699],
  toronto: [-79.3832, 43.6532], montreal: [-73.5673, 45.5017], montréal: [-73.5673, 45.5017], 'mexico city': [-99.1332, 19.4326], 'são paulo': [-46.6333, -23.5505],
  'sao paulo': [-46.6333, -23.5505], 'rio de janeiro': [-43.1729, -22.9068], 'buenos aires': [-58.3816, -34.6037], london: [-0.1276, 51.5072], londres: [-0.1276, 51.5072],
  paris: [2.3522, 48.8566], berlin: [13.405, 52.52], madrid: [-3.7038, 40.4168], rome: [12.4964, 41.9028], milan: [9.19, 45.4642], amsterdam: [4.9041, 52.3676],
  brussels: [4.3517, 50.8503], bruxelles: [4.3517, 50.8503], geneva: [6.1432, 46.2044], genève: [6.1432, 46.2044], zurich: [8.5417, 47.3769], moscow: [37.6173, 55.7558],
  moscou: [37.6173, 55.7558], istanbul: [28.9784, 41.0082], dubai: [55.2708, 25.2048], dubaï: [55.2708, 25.2048], cairo: [31.2357, 30.0444], 'le caire': [31.2357, 30.0444],
  lagos: [3.3792, 6.5244], johannesburg: [28.0473, -26.2041], mumbai: [72.8777, 19.076], delhi: [77.1025, 28.7041], beijing: [116.4074, 39.9042], pékin: [116.4074, 39.9042],
  shanghai: [121.4737, 31.2304], 'hong kong': [114.1694, 22.3193], tokyo: [139.6917, 35.6895], seoul: [126.978, 37.5665], séoul: [126.978, 37.5665], singapore: [103.8198, 1.3521],
  singapour: [103.8198, 1.3521], bangkok: [100.5018, 13.7563], sydney: [151.2093, -33.8688], melbourne: [144.9631, -37.8136], lyon: [4.8357, 45.764], marseille: [5.3698, 43.2965],
  // Countries (approximate centres)
  'united states': [-98.5795, 39.8283], usa: [-98.5795, 39.8283], 'états-unis': [-98.5795, 39.8283], canada: [-106.3468, 56.1304], mexico: [-102.5528, 23.6345],
  mexique: [-102.5528, 23.6345], brazil: [-51.9253, -14.235], brésil: [-51.9253, -14.235], france: [2.2137, 46.2276], germany: [10.4515, 51.1657], allemagne: [10.4515, 51.1657],
  'united kingdom': [-3.436, 55.3781], 'royaume-uni': [-3.436, 55.3781], spain: [-3.7492, 40.4637], espagne: [-3.7492, 40.4637], italy: [12.5674, 41.8719], italie: [12.5674, 41.8719],
  russia: [105.3188, 61.524], russie: [105.3188, 61.524], china: [104.1954, 35.8617], chine: [104.1954, 35.8617], japan: [138.2529, 36.2048], japon: [138.2529, 36.2048],
  india: [78.9629, 20.5937], inde: [78.9629, 20.5937], australia: [133.7751, -25.2744], australie: [133.7751, -25.2744], 'south africa': [22.9375, -30.5595], nigeria: [8.6753, 9.082],
  egypt: [30.8025, 26.8206], égypte: [30.8025, 26.8206],
};

const MAX_WORDS = 3;

const clean = (w: string) => w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, '');

/** Places named in a sentence (multi-word names first). */
export function findPlaces(words: readonly string[]): Array<{ name: string; coordinates: [number, number]; wordIndex: number }> {
  const out: Array<{ name: string; coordinates: [number, number]; wordIndex: number }> = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = MAX_WORDS; n >= 1; n--) {
      if (i + n > words.length) continue;
      const slice = words.slice(i, i + n);
      // Place names are capitalised in the script.
      if (!/^\p{Lu}/u.test(slice[0]!.replace(/^[^\p{L}]+/u, ''))) continue;
      const key = slice.map(clean).join(' ');
      const coordinates = PLACES[key];
      if (coordinates) {
        out.push({ name: slice.join(' ').replace(/[.,;:!?]+$/, ''), coordinates, wordIndex: i });
        i += n - 1;
        break;
      }
    }
  }
  return out;
}

export function lookupPlace(name: string): [number, number] | undefined {
  return PLACES[name.toLowerCase()];
}
