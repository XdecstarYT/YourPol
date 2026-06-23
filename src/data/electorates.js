// data/electorates.js — the 151 federal divisions (electorates) of the House of
// Representatives, by state, using real division names for authenticity.
// `kind` drives the baseline ideological lean of each seat at game start.
//
// kinds: inner = progressive inner-metro, suburb = swing outer-metro,
//        teal = wealthy small-l-liberal/independent-leaning, regional =
//        conservative country, mining = resources seats, coastal = mixed,
//        remote = sparse/Indigenous-heavy.

export const ELECTORATES = [
  // --- New South Wales (46) ---
  ['Sydney','NSW','inner'],['Grayndler','NSW','inner'],['Kingsford Smith','NSW','suburb'],
  ['Wentworth','NSW','teal'],['Warringah','NSW','teal'],['Mackellar','NSW','teal'],
  ['North Sydney','NSW','teal'],['Bradfield','NSW','teal'],['Bennelong','NSW','suburb'],
  ['Berowra','NSW','suburb'],['Mitchell','NSW','suburb'],['Greenway','NSW','suburb'],
  ['Chifley','NSW','suburb'],['McMahon','NSW','suburb'],['Fowler','NSW','suburb'],
  ['Werriwa','NSW','suburb'],['Macarthur','NSW','suburb'],['Hughes','NSW','suburb'],
  ['Cook','NSW','suburb'],['Banks','NSW','suburb'],['Barton','NSW','inner'],
  ['Watson','NSW','suburb'],['Blaxland','NSW','suburb'],
  ['Parramatta','NSW','suburb'],['Lindsay','NSW','suburb'],['Macquarie','NSW','coastal'],
  ['Robertson','NSW','coastal'],['Dobell','NSW','coastal'],['Shortland','NSW','coastal'],
  ['Newcastle','NSW','inner'],['Hunter','NSW','mining'],['Paterson','NSW','coastal'],
  ['Cunningham','NSW','inner'],['Whitlam','NSW','suburb'],['Gilmore','NSW','coastal'],
  ['Eden-Monaro','NSW','coastal'],['Hume','NSW','regional'],['Riverina','NSW','regional'],
  ['Farrer','NSW','regional'],['Parkes','NSW','regional'],['Calare','NSW','regional'],
  ['New England','NSW','regional'],['Lyne','NSW','regional'],['Cowper','NSW','coastal'],
  ['Page','NSW','coastal'],['Richmond','NSW','coastal'],

  // --- Victoria (39) ---
  ['Melbourne','VIC','inner'],['Cooper','VIC','inner'],['Wills','VIC','inner'],
  ['Macnamara','VIC','inner'],['Higgins','VIC','suburb'],['Kooyong','VIC','teal'],
  ['Goldstein','VIC','teal'],['Chisholm','VIC','suburb'],['Hotham','VIC','suburb'],
  ['Bruce','VIC','suburb'],['Holt','VIC','suburb'],['Isaacs','VIC','suburb'],
  ['Dunkley','VIC','suburb'],['Flinders','VIC','coastal'],['La Trobe','VIC','suburb'],
  ['Casey','VIC','suburb'],['Deakin','VIC','suburb'],['Menzies','VIC','suburb'],
  ['Aston','VIC','suburb'],['Jagajaga','VIC','suburb'],['Scullin','VIC','suburb'],
  ['Maribyrnong','VIC','suburb'],['Gellibrand','VIC','inner'],['Fraser','VIC','suburb'],
  ['Gorton','VIC','suburb'],['Hawke','VIC','suburb'],['Calwell','VIC','suburb'],
  ['McEwen','VIC','coastal'],['Nicholls','VIC','regional'],['Indi','VIC','regional'],
  ['Wannon','VIC','regional'],['Mallee','VIC','regional'],['Bendigo','VIC','regional'],
  ['Ballarat','VIC','regional'],['Corangamite','VIC','coastal'],['Corio','VIC','suburb'],
  ['Lalor','VIC','suburb'],['Monash','VIC','regional'],['Gippsland','VIC','regional'],

  // --- Queensland (30) ---
  ['Brisbane','QLD','inner'],['Griffith','QLD','inner'],['Moreton','QLD','suburb'],
  ['Lilley','QLD','suburb'],['Petrie','QLD','suburb'],['Dickson','QLD','suburb'],
  ['Ryan','QLD','teal'],['Bonner','QLD','suburb'],['Bowman','QLD','suburb'],
  ['Forde','QLD','suburb'],['Rankin','QLD','suburb'],['Oxley','QLD','suburb'],
  ['Blair','QLD','regional'],['Wright','QLD','regional'],['Fadden','QLD','coastal'],
  ['Fisher','QLD','coastal'],['Fairfax','QLD','coastal'],['Wide Bay','QLD','regional'],
  ['Hinkler','QLD','regional'],['Flynn','QLD','mining'],['Capricornia','QLD','mining'],
  ['Dawson','QLD','mining'],['Herbert','QLD','mining'],['Kennedy','QLD','regional'],
  ['Leichhardt','QLD','coastal'],['Maranoa','QLD','regional'],['Groom','QLD','regional'],
  ['Longman','QLD','suburb'],['Moncrieff','QLD','coastal'],['McPherson','QLD','coastal'],

  // --- Western Australia (16) ---
  ['Perth','WA','inner'],['Curtin','WA','teal'],['Swan','WA','suburb'],
  ['Tangney','WA','suburb'],['Hasluck','WA','suburb'],['Cowan','WA','suburb'],
  ['Stirling','WA','suburb'],['Moore','WA','suburb'],['Pearce','WA','suburb'],
  ['Canning','WA','suburb'],['Burt','WA','suburb'],['Brand','WA','suburb'],
  ['Fremantle','WA','inner'],['Forrest','WA','regional'],['O\'Connor','WA','mining'],
  ['Durack','WA','mining'],

  // --- South Australia (10) ---
  ['Adelaide','SA','inner'],['Sturt','SA','suburb'],['Boothby','SA','suburb'],
  ['Hindmarsh','SA','suburb'],['Kingston','SA','suburb'],['Mayo','SA','teal'],
  ['Makin','SA','suburb'],['Spence','SA','suburb'],['Grey','SA','regional'],
  ['Barker','SA','regional'],

  // --- Tasmania (5) ---
  ['Clark','TAS','inner'],['Franklin','TAS','coastal'],['Bass','TAS','coastal'],
  ['Braddon','TAS','regional'],['Lyons','TAS','regional'],

  // --- ACT (3) ---
  ['Canberra','ACT','inner'],['Fenner','ACT','inner'],['Bean','ACT','suburb'],

  // --- NT (2) ---
  ['Lingiari','NT','remote'],['Solomon','NT','suburb'],
].map(([name, state, kind]) => ({ name, state, kind }));

// Baseline ideological tilt by seat kind (econ, soc); negative = left/progressive.
export const KIND_LEAN = {
  inner:    { econ: -0.35, soc: -0.45, volatility: 0.10 },
  teal:     { econ:  0.10, soc: -0.30, volatility: 0.16 },
  suburb:   { econ:  0.02, soc:  0.04, volatility: 0.20 },
  coastal:  { econ:  0.08, soc:  0.06, volatility: 0.18 },
  regional: { econ:  0.35, soc:  0.40, volatility: 0.12 },
  mining:   { econ:  0.30, soc:  0.35, volatility: 0.22 },
  remote:   { econ: -0.20, soc: -0.10, volatility: 0.25 },
};
