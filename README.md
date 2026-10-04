# Banners of the Realm

A medieval strategy game for the browser: a grand-strategy campaign map (in the spirit of CK3 / Total War) where armies clash in tactical battles. Battles use simultaneous turns, like *Lines of Battle*: you plan orders while the game is paused, then watch 5 seconds of real-time combat play out.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints. Add `?seed=123` to replay a specific map, or `?debug` to expose the game as `window.banners` in the console.

## How to play

- **Campaign:** click your blue banner to select an army, then click a neighbouring province to march. Click one of your provinces to recruit regiments. Press **Enter** to end your turn. Destroy the three rival realms to win.
- **Battle:** left-click or drag a box to select regiments, right-click the ground to move, and right-click an enemy to attack. Press **Space** to execute the round.
- **Units:** spearmen hold the line and stop cavalry. Archers shoot when standing still. Knights hit hard on the charge but break on braced spears. Flank and rear attacks deal bonus damage. Forests slow movement and block arrows.

## Code layout

| Path | What it does |
| --- | --- |
| `src/campaign/mapgen.ts` | Procedural continent and provinces (noise landmass + noisy Dijkstra growth) |
| `src/campaign/state.ts` | Game state, factions, armies, economy, auto-resolve |
| `src/campaign/ai.ts` | Campaign AI: recruiting and choosing targets |
| `src/campaign/scene.ts` | Map rendering, input, side panel, turn flow |
| `src/battle/battle.ts` | Tactical simulation (movement, melee, missiles, morale) and battle AI |
| `src/battle/scene.ts` | Battle rendering, selection and orders, results |
| `src/data.ts` | Unit stats, factions, names: the place to tweak balance |

No game engine: it's plain TypeScript on a 2D canvas, built with Vite.
