# Australia: The Ultimate Political Simulator

A deep, emergent political / government / economic grand-strategy simulation of
the Commonwealth of Australia, inspired by *Lawgivers II* but built around a
fully interacting systems model. You start as an ordinary citizen and can rise
to Prime Minister, shaping the nation's laws, budget, economy and society from
**2026 onward** — every decision rippling through a living simulation.

> **Status: playable foundation (v0.1).** This is an honest, working vertical
> slice of an enormous design. The core simulation loop and the systems that
> make it *feel* alive are implemented and interacting. The full design brief
> (millions of individually-modelled citizens, every nation on Earth, multiplayer,
> modding, centuries of fully-detailed world history) is a multi-year effort;
> see [Roadmap](#roadmap) for exactly what is and isn't here yet.

---

## Production features

- **Title screen & character creation** — name, starting career, party allegiance and three difficulty levels (Backbencher / Statesman / Crisis Nation).
- **Procedural audio** — a full sound-effect set and generative ambient music synthesised at runtime with the Web Audio API. No audio files; works completely offline. Toggle in Settings.
- **Live data visualisation** — canvas trend charts (approval & happiness over time), an energy-mix donut, and KPI cards on the National Dashboard.
- **Meta-game** — context-aware **objectives**, 15 unlockable **achievements** with pop-up notifications, and a final **legacy score & grade** for each playthrough.
- **Polish** — animated toast notifications, audio cues on every major action, settings persistence, a redesigned modern UI.

## Running it

No build step, no dependencies — it's vanilla ES modules. You just need any
static file server (the browser blocks ES-module imports from `file://`).

```bash
# from the repo root
npm start          # → python3 -m http.server 8080
# then open http://localhost:8080
```

Or use any equivalent (`npx serve`, VS Code Live Server, etc.).

---

## What's implemented (and how the systems interact)

The whole point of the design is that **no system exists in isolation**. Here is
the live causal chain you can watch unfold:

```
 tax rates ─┐
 spending  ─┼─► budget balance ─► debt + interest ─► economy (growth,
 economy ───┘                                          inflation, jobs, rates)
                                       │
 budget line items ───► national metrics (health, housing, safety, …)
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                                ▼
              citizen cohorts                    government approval
          (happiness, trust, ageing)                    │
                       │                                 │
                       ▼                                 ▼
            party support (ideology match) ──► elections (preferential)
                       │                                 │
                       ▼                                 ▼
            parliament composition ──► legislation ──► new laws ──► (loops back
                                                                     into metrics)
```

| System | What it does |
|---|---|
| **Time & loop** | Real-time monthly ticks from Jan 2026, pause + 3 speeds. Seeded RNG → reproducible playthroughs. |
| **National metrics** | 11 Lawgivers-style indicators (Happiness, Institutions, Housing, Safety, Education, Environment, Entertainment, Freedom, Economy, Health, Transport) driven by spending, the economy and active laws. |
| **Economy** | GDP, growth, inflation, unemployment (Okun), a toy RBA cash-rate rule, consumer/business confidence, net debt with compounding interest. |
| **Budget & tax** | Line-item spending (health, education, welfare, defence, …) and adjustable tax rates (income, company, GST, CGT, carbon, resources) with a Laffer-style revenue model. |
| **Citizens** | A weighted **cohort model** (age band × state × ideology) standing in for millions of voters — they have happiness, trust, age, and ideology that drifts via generational replacement. |
| **Parties & politicians** | 7 parties on a 2-D ideology map; the Coalition runs together. Procedurally generated MPs with public traits, hidden traits (ego, greed, loyalty, risk…), 10 skills, popularity, competence and scandal risk. |
| **Elections** | **All 151 real named divisions** (Sydney, Kooyong, Maranoa…) each contested with a full **preferential / instant-runoff** count, **two-candidate-preferred margins**, **seat-by-seat swings**, a national **two-party-preferred**, and an **electoral pendulum**. Proportional Senate; automatic government formation (majority / minority / Coalition). A **live election-night screen** counts seats in progressively, calling gains and swings in real time. |
| **State governments** | All 8 states & territories have their own governing party, **Premier / Chief Minister**, approval, and **staggered four-year election cycles** that run independently. |
| **Referendums** | Call national referendums (Republic, Voice, four-year terms, bill of rights…), decided by the constitutional **double majority** (national majority + 4 of 6 states). |
| **High Court** | Seven Justices with their own interpretive philosophies; enacted laws can be **challenged and struck down** on constitutional grounds; the government appoints replacements as Justices retire at 70. |
| **Industry & energy** | Ten industries (mining, tech, finance, agriculture…) each respond to their own policy/economic levers and feed back into GDP and jobs. A **national energy grid** trades off mix, reliability, price and emissions, with nuclear unlockable by law. |
| **Media & society** | Media outlets cover the government through their own bias; social-media sentiment, virality and disinformation; **lobby groups** pressing agendas; and **civil unrest** that erupts into strikes, protests and riots. |
| **Foreign & defence** | A living world of nations with their own economies and leaders; diplomatic relations, trade, treaties, sanctions and aid; defence forces and an intelligence threat picture (cyber, interference, terror). |
| **Dynasties** | Prominent figures form families whose children can enter politics, the judiciary, media or business — dynasties that rise across generations. |
| **Legislation** | A 12-policy catalogue. Bills progress House → Senate → Royal Assent; **AI MPs vote by ideology weighted by party loyalty**. Enacted laws apply immediate + ongoing effects and can be repealed. |
| **Crises & scandals** | Dynamic events (bushfires, floods, recession, pandemic, cyber-attack, housing crisis) that pause the game for your decision when you govern; politicians (including you) can be caught in scandals. |
| **Your career** | Start as one of 10 careers → join a party → **campaign in a chosen seat** → win it → climb Backbencher → Shadow → Minister → Treasurer → Leader → **Prime Minister**, unlocking real powers (budget, legislation, referendums) as you rise. |
| **3D presentation** | A **3D perspective parliament chamber** (ideologically-seated hemicycle with the PM and you highlighted) and a **tilted 3D state map**. |
| **Historical archive** | Every election, law, referendum, crisis and scandal is recorded permanently and browsable. |
| **Save / load** | Whole-state serialisation to `localStorage`, including RNG state. |

### How to play

1. Open the app, choose a name and a starting career (or *Observe only*).
2. Press **▶** to let time run; **⏸** to pause and act.
3. Go to **🎖️ Your Career** → *Join a Party*, then *Campaign* and *Stand for Election*.
4. Win your seat, then *Push for Promotion* up the ladder.
5. Once you're a Minister/Treasurer/PM in government, the **⚖️ Legislation** and
   **💵 Budget & Tax** screens unlock — pass laws, set the budget, and watch the
   metrics, economy and your approval respond.

---

## Architecture

Dependency-free, browser-native ES modules. **Simulation is completely decoupled
from rendering** — the sim never touches the DOM, the UI is a pure function of
state + an `api` of actions. This is what makes future multiplayer, headless
servers, and automated testing tractable.

```
index.html              # shell: top bar, panels, view rail, control bar, modal
styles/main.css         # Lawgivers-inspired chrome
src/
  engine.js             # seeded RNG, event bus, time, formatting, save/load
  data.js               # Australia: states, seats, parties, careers, event templates
  ui.js                 # all rendering + interaction (pure view layer)
  main.js               # controller: game loop + the api the UI calls
  sim/
    index.js            # tick orchestrator + barrel re-exports
    state.js            # world init, procedural politicians, government formation
    economy.js          # economy, budget, revenue, national metrics, approval
    cohorts.js          # the living citizen/voter population model
    elections.js        # voter behaviour, preferential counting, gov formation
    legislation.js      # bill lifecycle, party-line voting, law effects
    events.js           # crises & scandals
    career.js           # the player's path to power
```

The simulation core is verified with two headless Node smoke tests (20-year run;
career → PM → legislation → save/load round-trip).

---

## Roadmap

This foundation deliberately maps onto the full design brief so each large system
has a clear home to grow into. Implemented ✓ / planned ○:

- ✓ Core simulation loop, seeded RNG, save/load
- ✓ National metrics, economy, budget, taxation
- ✓ Cohort-based population & voter model
- ✓ Parties, AI politicians (traits/skills/hidden agendas)
- ✓ **Realistic elections** — 151 named seats, preferential counts, 2CP margins, swings, 2PP, pendulum, live election night
- ✓ **State & territory governments** with premiers and their own election cycles
- ✓ **Referendums** with the constitutional double-majority rule
- ✓ Legislative process & repeal
- ✓ Crises, scandals, historical archive
- ✓ Player career ladder to PM (with seat selection & campaigning)
- ✓ **3D parliament chamber + tilted 3D map**, redesigned modern UI
- ✓ **Judicial system / High Court** — seven Justices, constitutional challenges, laws struck down, government appointments on retirement
- ✓ **Per-industry economic modelling** (10 sectors) + **national energy grid** (mix, reliability, price, emissions, nuclear)
- ✓ **Media & social-media dynamics, lobby groups, civil unrest**
- ✓ **Foreign relations, defence & intelligence** with a living world of nations (trade, treaties, sanctions, aid)
- ✓ **Political dynasties / family trees**
- ✓ **Lightweight world simulation** — foreign nations with their own economies, leaders and relations
- ○ Individually-simulated citizens at full scale (current model is statistical cohorts)
- ○ Additional playable countries / historical scenarios
- ○ Modding, Steam Workshop, multiplayer (architectural foundations only)

Contributions and forks welcome — the modular `sim/` layout is designed so new
systems plug into the tick orchestrator without touching the others.

## License

MIT
