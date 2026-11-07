# Swarajya

A grand-strategy game set in India in **1670**, the year Shivaji began retaking the forts he had surrendered to the Mughals at Purandar. You lead the Marathas from Raigad against the Mughal Empire, the Deccan sultanates and the coastal powers. The campaign map is turn-based; battles and sieges are fought in real time with pause.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints. Add `?seed=123` to fix the random seed (terrain detail and battle layouts), or `?debug` to expose the game as `window.banners` in the console.

## The campaign

- **Map:** the Indian subcontinent with 137 historical provinces, rivers, the Ghats and the Himalaya. Drag to pan, scroll to zoom.
- **Realms in 1670:** Marathas (you), Mughals, Bijapur, Golconda, the Siddis of Janjira, the Portuguese, the English, the Rajput states, Mysore, the Nayaks of Madurai, the Ahoms, and independent chiefs. You start at war with the Mughals and Siddis; the Mughals are also at war with the Ahoms.
- **Settlements:** every province has a fort, city or port with walls (open, mud, stone, or hill/sea fort), a garrison and food stores.
- **Sieges:** marching into a walled enemy province starts a siege. Each turn the defenders eat their stores, and your camp builds ladders, then a ram. Either starve them out, or **assault**, which is a real-time siege battle. Mavalas bring ladders from day one.
- **Taking towns:** a captured town can be **occupied** (steady income) or **sacked** (a fortune now, a ruined province later).
- **Raids (chauth):** plunder an enemy province for gold. It pays its owner nothing for three turns.
- **Regions:** hold every province of a region for +25% revenue there.
- **Seasons:** each turn is a season. In the monsoon every army moves one province, armies in hostile land lose men, sieges stall, and rain spoils bows and matchlocks.
- **Diplomacy:** declare war, or send envoys for peace. Independent chiefs may be attacked at any time.
- **Victory:** hold 35 provinces or take Delhi.

## Battles

Battles are real-time with pause. First there is a deployment phase; press **Space** to begin, and Space again to pause at any time. Use **1/2/3** for speed.

- **Field battles:** terrain comes from the province (forest, hills, desert, plains). Flank and rear attacks deal extra damage, charges hit hard, and spears brace against horse and elephants. Morale breaks, and routs spread to nearby units.
- **Sieges:** walls, a gate and towers that shoot attackers. Guns and elephants batter walls; infantry hack at the gate (much faster with a ram); ladders let infantry climb. The attacker wins by breaking the garrison, or by holding the town square.

| Unit | Role |
| --- | --- |
| Mavalas | Fast Maratha hill infantry. Strong in forests and hills, quick on ladders |
| Spearmen | Brace against cavalry and elephants |
| Archers / Horse Archers | Steady missile fire; horse archers shoot on the move and skirmish |
| Matchlocks | Slow, armour-piercing volleys that panic elephants; rain causes misfires |
| Light / Heavy Horse | Raiders and flankers / crushing shock charge |
| War Elephants | Terrify nearby enemies and smash gates; may run amok when they rout |
| Rocketmen | Inaccurate, but they panic elephants and horses |
| Siege Guns | Very slow, very long range, smash walls |

## Code layout

| Path | What it does |
| --- | --- |
| `src/india.ts` | Hand-traced geography: coast, frontiers, ranges, rivers, and the 1670 province list |
| `src/geo.ts` | Map projection and grid constants |
| `src/data.ts` | Unit stats, faction rosters and colours: the place to tweak balance |
| `src/campaign/mapgen.ts` | Rasterises the geography and grows provinces from their real settlements |
| `src/campaign/state.ts` | Game state, economy, sieges, sacks, raids, diplomacy, seasons |
| `src/campaign/flow.ts` | Move/battle/siege/capture rules (DOM-free, runs headless) |
| `src/campaign/ai.ts` | Campaign AI: war declarations, recruiting, sieges, assaults |
| `src/campaign/mapRender.ts` / `scene.ts` | Map painting, camera, input and side panels |
| `src/battle/battle.ts` | Real-time combat: melee, missiles, morale, walls, ladders, towers |
| `src/battle/ai.ts` | Battle AI for field battles and for attacking or defending sieges |
| `src/battle/scene.ts` | Battle rendering, controls and results |

It's plain TypeScript drawing on a canvas, with no engine, built with Vite.
