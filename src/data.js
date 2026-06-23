// data.js — starting data for the Commonwealth of Australia (circa 2026).
// Figures are plausible/illustrative starting values, not official statistics.

/* States & territories. hor = House of Representatives seats (total 151),
   senate seats per state = 12, territories = 2 (total 76).
   pop in millions, lean is a baseline two-party-preferred tilt (-1 left .. +1 right). */
export const STATES = [
  { code: 'NSW', name: 'New South Wales',               pop: 8.35, hor: 46, senate: 12, lean:  0.02 },
  { code: 'VIC', name: 'Victoria',                       pop: 6.85, hor: 39, senate: 12, lean: -0.06 },
  { code: 'QLD', name: 'Queensland',                     pop: 5.50, hor: 30, senate: 12, lean:  0.10 },
  { code: 'WA',  name: 'Western Australia',              pop: 2.95, hor: 16, senate: 12, lean:  0.04 },
  { code: 'SA',  name: 'South Australia',                pop: 1.85, hor: 10, senate: 12, lean: -0.02 },
  { code: 'TAS', name: 'Tasmania',                       pop: 0.58, hor:  5, senate: 12, lean: -0.04 },
  { code: 'ACT', name: 'Australian Capital Territory',   pop: 0.47, hor:  3, senate:  2, lean: -0.18 },
  { code: 'NT',  name: 'Northern Territory',             pop: 0.26, hor:  2, senate:  2, lean: -0.02 },
];

export const TOTAL_HOR = 151;     // majority = 76
export const TOTAL_SENATE = 76;   // majority = 39

/* National metrics shown in the left panel (Lawgivers-style).
   key, label, icon, and which budget/policy areas push them up. */
export const METRICS = [
  { key: 'happiness',     label: 'Happiness',     icon: '😊' },
  { key: 'institutions',  label: 'Institutions',  icon: '🏛️' },
  { key: 'housing',       label: 'Housing',       icon: '🏠' },
  { key: 'safety',        label: 'Safety',        icon: '🛡️' },
  { key: 'education',     label: 'Education',     icon: '🎓' },
  { key: 'environment',   label: 'Environment',   icon: '🌿' },
  { key: 'entertainment', label: 'Entertainment', icon: '🎭' },
  { key: 'freedom',       label: 'Freedom',       icon: '🕊️' },
  { key: 'economy',       label: 'Economy',       icon: '📈' },
  { key: 'health',        label: 'Health',        icon: '🏥' },
  { key: 'transport',     label: 'Transport',     icon: '🚆' },
];

/* Ideology is a 2D vector: economic (-1 left .. +1 right) and social
   (-1 progressive .. +1 conservative). Used for party support & legislation. */
export const PARTIES = [
  { id: 'alp',  name: 'Australian Labor Party',   short: 'Labor',     colour: '#d6322f', econ: -0.45, soc: -0.25, base: 0.31 },
  { id: 'lib',  name: 'Liberal Party',            short: 'Liberal',   colour: '#1f4ea1', econ:  0.50, soc:  0.30, base: 0.27 },
  { id: 'nat',  name: 'The Nationals',            short: 'Nationals', colour: '#0a6b3b', econ:  0.40, soc:  0.45, base: 0.04 },
  { id: 'grn',  name: 'Australian Greens',        short: 'Greens',    colour: '#3fa65a', econ: -0.70, soc: -0.65, base: 0.13 },
  { id: 'onp',  name: 'One Nation',               short: 'One Nation',colour: '#f08a24', econ:  0.20, soc:  0.80, base: 0.06 },
  { id: 'tea',  name: 'Community Independents',    short: 'Teals',     colour: '#0aa9a0', econ:  0.05, soc: -0.40, base: 0.07 },
  { id: 'ind',  name: 'Independents & Others',     short: 'Ind/Other', colour: '#8a8f94', econ:  0.00, soc:  0.00, base: 0.12 },
];
// Liberal + Nationals run together as "the Coalition".
export const COALITION = ['lib', 'nat'];

export function partyById(id) { return PARTIES.find((p) => p.id === id); }

/* Difficulty presets — shape the starting hand and crisis frequency. */
export const DIFFICULTIES = [
  { id: 'easy',   name: 'Backbencher',  desc: 'Forgiving economy, fewer crises.' },
  { id: 'normal', name: 'Statesman',    desc: 'A balanced challenge.' },
  { id: 'hard',   name: 'Crisis Nation',desc: 'High debt, anger and frequent crises.' },
];

/* Player career ladder. Each rung unlocks powers in the sim. */
export const CAREERS = [
  { id: 'student',     name: 'Student',            influence: 2 },
  { id: 'journalist',  name: 'Journalist',         influence: 5 },
  { id: 'lawyer',      name: 'Lawyer',             influence: 6 },
  { id: 'teacher',     name: 'Teacher',            influence: 4 },
  { id: 'activist',    name: 'Activist',           influence: 5 },
  { id: 'unionist',    name: 'Union Official',     influence: 7 },
  { id: 'business',    name: 'Business Owner',     influence: 7 },
  { id: 'ceo',         name: 'CEO',                influence: 9 },
  { id: 'staffer',     name: 'Political Staffer',  influence: 6 },
  { id: 'councillor',  name: 'Local Councillor',   influence: 8 },
];
// Elected ranks (rising power). 'pm' grants full government control in-sim.
export const RANKS = [
  { id: 'candidate', name: 'Candidate',          power: 0 },
  { id: 'backbench', name: 'Backbench MP',       power: 1 },
  { id: 'shadow',    name: 'Shadow Minister',    power: 2 },
  { id: 'minister',  name: 'Cabinet Minister',   power: 3 },
  { id: 'treasurer', name: 'Treasurer',          power: 4 },
  { id: 'leader',    name: 'Party Leader',       power: 5 },
  { id: 'pm',        name: 'Prime Minister',     power: 6 },
];

/* Name banks for procedural politicians & citizens. */
export const FIRST_NAMES = ['James','Sarah','Michael','Emily','David','Jessica','Daniel','Olivia','Matthew','Sophie','Andrew','Hannah','Joshua','Grace','Benjamin','Chloe','Samuel','Ava','Thomas','Mia','Nathan','Ruby','Liam','Charlotte','Ethan','Isla','Lachlan','Zoe','Aiden','Amelia','Kai','Layla','Noah','Ella','Aarav','Priya','Wei','Ling','Ahmed','Fatima','Tane','Mereana','Jarrah','Kirra'];
export const LAST_NAMES = ['Smith','Nguyen','Williams','Brown','Jones','Wilson','Taylor','Lee','Martin','Patel','Singh','Chen','Wang','Ali','Kelly','Ryan','Robinson','Walker','Harris','Clarke','Murphy','Campbell','Stewart','OBrien','Mokbel','Tran','Pham','Kaur','Yilmaz','Rossi','Kovac','Andersson','Fitzgerald','Watson','Bennett','Hughes','Ferguson','Coleman','Marshall','Dixon'];

/* Crisis & event templates. Each has weight, effects, and player choices. */
export const EVENT_TEMPLATES = [
  {
    id: 'bushfire', title: 'Catastrophic Bushfires', weight: 1.0, icon: '🔥',
    text: 'Severe bushfires sweep across the eastern states. Communities are evacuated and the army is on standby.',
    effects: { environment: -8, safety: -6, happiness: -4 },
    choices: [
      { label: 'Deploy ADF & emergency funding ($6B)', spend: 6, eff: { safety: +5, happiness: +3, institutions: +2 } },
      { label: 'Coordinate state response only', eff: { safety: +1, institutions: -3 } },
      { label: 'Downplay the crisis', eff: { happiness: -5, institutions: -6, environment: -2 } },
    ],
  },
  {
    id: 'flood', title: 'Record Flooding', weight: 1.0, icon: '🌊',
    text: 'A low-pressure system dumps a year of rain in days. Towns are inundated and crops destroyed.',
    effects: { housing: -6, transport: -5, economy: -3 },
    choices: [
      { label: 'Major recovery package ($8B)', spend: 8, eff: { housing: +4, transport: +3, happiness: +3 } },
      { label: 'Standard disaster relief ($2B)', spend: 2, eff: { housing: +1, happiness: +1 } },
      { label: 'Leave it to insurers', eff: { happiness: -4, institutions: -3 } },
    ],
  },
  {
    id: 'recession', title: 'Global Recession Warning', weight: 0.8, icon: '📉',
    text: 'Global markets tumble and economists warn of recession. The dollar slides.',
    effects: { economy: -9, happiness: -3 },
    choices: [
      { label: 'Fiscal stimulus ($20B)', spend: 20, eff: { economy: +6, happiness: +2 } },
      { label: 'Hold the line on the budget', eff: { economy: -2, institutions: +2 } },
      { label: 'Cut spending to protect surplus', eff: { economy: -4, happiness: -4 } },
    ],
  },
  {
    id: 'pandemic', title: 'Emerging Pandemic', weight: 0.5, icon: '🦠',
    text: 'A novel respiratory virus is spreading. Health authorities request urgent direction.',
    effects: { health: -10, economy: -6, freedom: -2 },
    choices: [
      { label: 'Lockdowns & mass vaccination ($15B)', spend: 15, eff: { health: +8, economy: -4, freedom: -6 } },
      { label: 'Targeted health response ($5B)', spend: 5, eff: { health: +3, economy: -1 } },
      { label: 'Keep society fully open', eff: { health: -6, freedom: +4, economy: +2 } },
    ],
  },
  {
    id: 'cyber', title: 'Major Cyber Attack', weight: 0.7, icon: '💻',
    text: 'A state-linked group breaches critical infrastructure and leaks millions of records.',
    effects: { safety: -6, institutions: -4 },
    choices: [
      { label: 'Stand up Cyber Command ($4B)', spend: 4, eff: { safety: +4, institutions: +3 } },
      { label: 'Quiet diplomatic response', eff: { institutions: -2 } },
      { label: 'Public attribution & sanctions', eff: { safety: +2, institutions: +2 } },
    ],
  },
  {
    id: 'housing', title: 'Housing Affordability Crisis', weight: 1.1, icon: '🏚️',
    text: 'Median house prices hit a record multiple of income. Young voters are furious.',
    effects: { housing: -8, happiness: -5 },
    choices: [
      { label: 'Build 200k social homes ($12B)', spend: 12, eff: { housing: +6, happiness: +4 } },
      { label: 'First-home buyer grants ($4B)', spend: 4, eff: { housing: +2, happiness: +2 } },
      { label: 'Trust the market', eff: { housing: -2, happiness: -3 } },
    ],
  },
];

/* Scandal templates (target politicians, including the player). */
export const SCANDAL_TEMPLATES = [
  { id: 'expenses', label: 'expense rorting',     severity: 0.4 },
  { id: 'affair',   label: 'an affair',           severity: 0.5 },
  { id: 'bribery',  label: 'taking a bribe',      severity: 0.9 },
  { id: 'insider',  label: 'insider trading',     severity: 0.8 },
  { id: 'leak',     label: 'leaking cabinet docs',severity: 0.6 },
  { id: 'donations',label: 'dodgy donations',     severity: 0.7 },
];
