# Swarajya

A real-time grand-strategy game set in India in **1670**, the year Shivaji began retaking the forts he had surrendered to the Mughals at Purandar. You lead the Marathas from Raigad against the Mughal Empire, the Deccan sultanates and the coastal powers. As in Mount & Blade: Bannerlord, the campaign map runs continuously (pause any time): every realm marches, fights, besieges and plunders at once. Battles and sieges are fought in real time with pause.

## Look

Styled after painted history-map videos (such as History Marche): realm colours laid over shaded relief, pale seas with glowing coasts, realm names in spaced Roman capitals (Cinzel), and towns as ink dots. Every army marches under a named commander's standard (Shivaji Bhonsle, Diler Khan, Ali Adil Shah…). On the battlefield, regiments are square two-tone counters carrying their military symbol, the commander's standard flies over his regiment, and the place name is written across the field.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints. Add `?seed=123` to fix the random seed (terrain detail and battle layouts), or `?debug` to expose the game as `window.banners` in the console.

## The campaign

- **Time:** the world clock runs from 1 January 1670. **Space** pauses or resumes, and **1/2/3** set the speed (1 day per second at 1×). Income and recruitment are monthly. The monsoon (June to September) slows every army, stalls siege works, wears down armies camped in hostile land, and spoils bows and matchlocks.
- **Map:** the Indian subcontinent with 137 historical provinces, rivers, the Ghats and the Himalaya. Drag to pan, scroll to zoom.
- **Orders:** select an army and right-click a town to march there along the roads, right-click an enemy army to hunt it down, or right-click one of your own armies to join it. All-horse armies march fastest; elephants and guns slow everyone down.
- **Encounters:** when a hunter catches its prey, or an AI army likes its odds, battle is joined. Every friendly or allied army within reach marches to join, and an army caught at its own town fights beside the garrison, so battles can grow to dozens of regiments a side. Sieges work the same way: nearby allies join the assault, and armies inside a town help defend it. If you are involved the game pauses and you choose: command the battle, auto-resolve it, or escape (with a rearguard lost if you are slower). AI-versus-AI battles play out on the map under a crossed-swords marker.
- **Sieges:** arriving before an enemy town opens a choice: besiege it, storm it if it has no walls, or raid its villages. A siege runs day by day: the garrison eats its food, and your camp builds ladders (4 days), then a ram (12 days). Assault whenever you like (every 2 days), or wait for a starving garrison to surrender. Mavalas bring ladders from day one.
- **Taking towns:** a captured town can be **occupied** (steady income) or **sacked** (a fortune now, devastated for half a year).
- **Raids (chauth):** plunder an enemy province's villages for 2 days for gold. It then pays its owner nothing for two months.
- **Realms in 1670:** Marathas (you), Mughals, Bijapur, Golconda, the Siddis of Janjira, the Portuguese, the English, the Rajput states, Mysore, the Nayaks of Madurai, the Ahoms, and independent chiefs. You start at war with the Mughals and Siddis; the AI declares wars and makes peace on its own.
- **Regions, building and diplomacy:** hold a whole region for +25% revenue there. Build walls or markets (one project a month per town). Declare war or send envoys for peace.
- **Manpower:** every regiment is drawn from a realm's pool of fighting men, which regrows each month from provinces that are not devastated or besieged. Recruiting, refilling ranks and rebuilding garrisons all use it up; regiments are raised under-strength when men are short. A realm that bleeds its manpower dry sues for peace, accepts it readily, and its garrisons start opening their gates.
- **Victory:** hold 35 provinces or take Delhi.

## Battles

Battles are real-time with pause on a large field. Scroll (or pinch) to zoom; use WASD, the arrow keys or middle-drag to pan. First there is a deployment phase in which armies form up in ranks; press **Space** to begin, and Space again to pause at any time. Use **1/2/3** for speed. An army holds up to 20 regiments.

- **Terrain decides battles:** hills give the high ground (stronger blows, longer range, downhill charges; uphill marches are slow); rivers can be crossed safely only at the sandy fords; marshes bog down horse and elephants; villages and woods give cover. **Right-drag** (or long-press and drag) to draw a curved path for the selected regiments; they wheel through turns rather than sliding.
- **Field battles:** terrain comes from the province (forest, hills, desert, plains, rivers, marsh). Flank and rear attacks deal extra damage, charges hit hard, and spears brace against horse and elephants. Morale breaks, and routs spread to nearby units.
- **Sieges:** walls, a gate and towers that shoot attackers. Guns and elephants batter walls; infantry hack at the gate (much faster with a ram); ladders let infantry climb. The attacker wins by breaking the garrison, or by holding the town square.

Every unit is marked with a NATO-style map symbol: a cross for infantry, a single diagonal for cavalry, a dot for gunpowder, and an oval for armour (elephants, armoured horse). Modifiers mark the type: a mountain for hill troops, a spearhead for pikes and lances, a bow arc for archers. A double frame marks guard troops. The **Troops** button on the campaign map opens the full tier list.

| Tier | Units |
| --- | --- |
| **S**: household and imperial guard | Huzurat Household Cavalry (Marathas, the best unit in the game), Ahadi Imperial Troopers (Mughals). Raised only at the capital, at most 3 regiments |
| **A**: elite | War Elephants, Rajput Cavalry, Habshi Guards, Firangi Musketeers |
| **B**: veteran | Shiledar Cavalry, Sowar Heavy Horse, Turani Horse Archers, Mavalas, Toradar Matchlocks, Siege Guns |
| **C**: regular | Bargir Light Horse, Bhaldar Spearmen, Tirandaz Archers, Ban Rocketmen |
| **D**: levy | Paik Levies |

## Code layout

| Path | What it does |
| --- | --- |
| `src/india.ts` | Hand-traced geography: coast, frontiers, ranges, rivers, and the 1670 province list |
| `src/geo.ts` | Map projection and grid constants |
| `src/data.ts` | Unit stats, tiers, faction rosters and colours: the place to tweak balance |
| `src/symbols.ts` | NATO-style unit symbols, drawn on canvas and as inline SVG |
| `src/campaign/mapgen.ts` | Rasterises the geography and grows provinces from their real settlements |
| `src/campaign/state.ts` | Game state, calendar, roads, economy, sieges, sacks, raids, diplomacy |
| `src/campaign/world.ts` | The real-time world: marching, encounters, AI battles, sieges, raids, the calendar (DOM-free, runs headless) |
| `src/campaign/ai.ts` | Campaign AI: per-army goals (conquer, hunt, relieve, flee, regroup), monthly recruiting and wars |
| `src/campaign/mapRender.ts` | Vector map: smoothed borders, coasts and rivers over painted terrain |
| `src/campaign/scene.ts` | Camera, time controls, armies and routes, orders, prompts and side panels |
| `src/battle/battle.ts` | Real-time combat: melee, missiles, morale, walls, ladders, towers |
| `src/battle/ai.ts` | Battle AI for field battles and for attacking or defending sieges |
| `src/battle/scene.ts` | Battle rendering, controls and results |

It's plain TypeScript drawing on a canvas, with no engine, built with Vite.
