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
- **Map:** the Indian subcontinent with 137 historical provinces, rivers, the Ghats and the Himalaya, in **3D**: real relief from the map's elevation (the Himalaya, the Ghats, the Deccan plateau), the painted map with realm colours, borders and rivers draped over it, a rippling sea, and little 3D forts, towns and ports at every settlement, with a company of soldiers in its colours marching under each army's banner. Drag to pan, scroll to zoom, **Z/C** or the ⟲ ⟳ buttons to turn the view, **Shift+drag** to turn and tilt it. The **3D/2D** button in the top bar switches to the flat painted map; the choice is shared with battles and remembered per browser.
- **Orders:** select an army and right-click a town to march there, right-click anywhere else to march straight across country to that spot, right-click an enemy army to hunt it down, or right-click one of your own armies to join it. Armies move freely over land: they go round the sea, prefer passes and valleys to high ridges, and are slowed by hill country. All-horse armies march fastest; elephants and guns slow everyone down. The date bar also counts the days since the campaign began.
- **Abandoned forts:** an army beaten in battle near one of its own forts takes the garrison with it as it flees. The fort stands empty for about three weeks, with no new garrison, and the victors can walk in. The AI is quick to do so.
- **Encounters:** when a hunter catches its prey, or an AI army likes its odds, battle is joined. Every friendly or allied army within reach marches to join, and an army caught at its own town fights beside the garrison, so battles can grow to dozens of regiments a side. Sieges work the same way: nearby allies join the assault, and armies inside a town help defend it. If you are involved the game pauses and you choose: command the battle, auto-resolve it, or escape (with a rearguard lost if you are slower). AI-versus-AI battles play out on the map under a crossed-swords marker.
- **Sieges:** arriving before an enemy town opens a choice: besiege it, storm it if it has no walls, or raid its villages. A siege runs day by day: the garrison eats its food, and your camp builds ladders (4 days), then a ram (12 days). Assault whenever you like (every 2 days), or wait for a starving garrison to surrender. Mavalas bring ladders from day one.
- **Taking towns:** a captured town can be **occupied** (steady income) or **sacked** (a fortune now, devastated for half a year).
- **Raids (chauth):** plunder an enemy province's villages for 2 days for gold. It then pays its owner nothing for two months.
- **Realms in 1670:** Marathas (you), Mughals, Bijapur, Golconda, the Siddis of Janjira, the Portuguese, the English, the Rajput states, Mysore, the Nayaks of Madurai, the Ahoms, and independent chiefs. You start at war with the Mughals and Siddis; the AI declares wars and makes peace on its own.
- **Regions, building and diplomacy:** hold a whole region for +25% revenue there. Build walls or markets (one project a month per town). Declare war or send envoys for peace.
- **Manpower:** every regiment is drawn from a realm's pool of fighting men, which regrows each month from provinces that are not devastated or besieged. Recruiting, refilling ranks and rebuilding garrisons all use it up; regiments are raised under-strength when men are short. A realm that bleeds its manpower dry sues for peace, accepts it readily, and its garrisons start opening their gates.
- **Supply and attrition:** armies carry a month of food (more under a quartermaster). In friendly country they refill; in enemy country they forage, which rich untouched land allows and ravaged land doesn't. Out of food, they starve. Raiding feeds an army.
- **Hill forts:** your forts feed and refill armies nearby, and ranks fill twice as fast there. Enemy forts' guns harass and slow armies on the passes. Each region has a key fort; its holder gets +15% revenue and +25% recruits across the region, and unrest where it's held by an enemy.
- **Chauth and sardeshmukhi:** at an enemy town (or during a siege), demand chauth. If they're afraid enough, the province pays a quarter of its revenue to you for a year, plus a lump sum now. If you already hold land in the region, sardeshmukhi adds another tenth. Plundering a tributary ends the deal. AI raiders may demand chauth from your towns.
- **Unrest and faith:** every province has unrest, driven by foreign rule, rulers of another faith, taxes, plunder, famine and recent conquest. Garrisons, temples and a tolerant policy calm it. Over 50 the province pays half, over 70 it sends no recruits, and at 80+ it may revolt: the deshmukhs go independent or declare for the realm whose people they are. The Desh and Konkan are Maratha country, so they resent Mughal and Bijapuri rule. Set your taxes (light, normal, heavy) and faith policy (tolerant, zealous) in the realm panel.
- **Commanders and court:** commanders have a trait (bold, cautious, horseman, siege master, raider, quartermaster) and gain rank from battles; both shape battles, sieges, marches and plunder. One whose regiment breaks may be killed or captured. Ransom your own back, or sell enemy captives back to their realm. Keep them loyal: an empty treasury or a refused request for land (a jagir) sours them, and a commander below 15 loyalty may defect with his whole army.
- **Diplomacy:** relations between courts; alliances (allies join your wars), marriage alliances, hostage exchanges (two years of sworn peace; breaking it is a disgrace), gifts, paying one realm to attack another, and peace on your terms: white peace, tribute, or a ceded province. Beaten AI realms offer land as well as gold.
- **Navy:** squadrons at the ports (Siddis, Portuguese, English, Mughals, and a young Maratha fleet at Sindhudurg). Raid enemy coasts for plunder, blockade a port (its trade dies and a besieged sea fort can't be fed by boat), or patrol your coast (+15% trade, intercepts raids). Squadrons fight whoever they meet. Build shipyards and ships in coastal provinces.
- **Buildings:** walls, markets, temples (calm unrest), stables (cheaper, seasoned cavalry), granaries (bigger stores, full wagons, no famine) and shipyards.
- **Spies:** scout an enemy army (otherwise you only know its rough size until you're close), sabotage siege works, bribe a besieged garrison to open its gates, or incite unrest in an enemy province. Enemy agents burn your siege works too. Besieged garrisons make night sorties to burn the besiegers' ladders and rams; you can order one from your own besieged towns.
- **Events:** the coronation at Raigad, a summons to the Mughal court, famines, sickness in camp, European traders, the blessing of Samarth Ramdas, defecting mansabdars and buried treasure, each with a choice.
- **Victory:** hold 35 provinces or take Delhi.

## Battles

Battles are real-time with pause on a large field, drawn in **3D** (Babylon.js): the painted battle map is draped over real hills, with woods of trees, village houses, towered siege walls that crumble as they're breached, and every regiment shown as a block of little soldiers (foot, horsemen, elephants with howdahs, guns with crews) in its colours, with its counter floating above. Sun, shadows, haze, morning mist and dusk light the field. Ground, walls and houses are textured (grass grain, dressed stone, lime plaster), with the textures generated in the browser rather than downloaded. **Z/C** (or the ⟲ ⟳ buttons) turn the camera and **Shift+middle-drag** turns and tilts it. The **3D/2D** button switches to the flat map view (remembered per browser; browsers without WebGL use 2D). Scroll (or pinch) to zoom; use WASD, the arrow keys or middle-drag to pan. First there is a deployment phase in which armies form up in ranks; press **Space** to begin, and Space again to pause at any time. Use **1/2/3** for speed. An army holds up to 20 regiments.

- **Terrain decides battles:** hills give the high ground (stronger blows, longer range, downhill charges; uphill marches are slow); rivers can be crossed safely only at the sandy fords; marshes bog down horse and elephants; villages and woods give cover. **Right-drag** (or long-press and drag) to draw a curved path for the selected regiments; they wheel through turns rather than sliding.
- **Battle lines at any angle:** **Shift+right-drag** (or press **Q** for line mode, also a button in the Orders panel) draws a straight battle line. The selected regiments spread along it, in ranks if there are more than fit (foot in front, then shooters, horse and guns), and wheel to face square to it: drag left to right to face up the field, right to left to face down. During deployment, right-drag always draws a line. Regiments keep the facing they were given until an enemy comes close.
- **Disengaging:** order a regiment that's locked in melee somewhere else and it breaks off with "Falling back!". For a few seconds it doesn't fight back and the enemy strikes its rear, and it loses a little morale. Horse gets away from foot; slow troops chased by fast ones may be caught again. The AI pulls out cavalry that's stuck against spears, and regiments about to break.
- **Field battles:** terrain comes from the province (forest, hills, desert, plains, rivers, marsh). Flank and rear attacks deal extra damage, charges hit hard, and spears brace against horse and elephants. Morale breaks, and routs spread to nearby units.
- **Flanks, charges and commanders:** a regiment fighting to its front holds its facing and wheels only slowly, so pinning it and striking its flank or rear pays: infantry deal far more damage on a flank, and cavalry charges only work from the side or behind. Head-on into formed infantry the charge breaks and the riders take losses, spears worst of all. Archers are cavalry's natural prey. Each side's commander rides with its strongest regiment; if that regiment routs or dies, every regiment on that side takes a heavy blow to morale.
- **Fog of war:** you see only what your regiments can see. Light horse scout furthest and high ground helps; ridges block sight; woods and villages hide anyone who keeps still in them. Enemies out of sight leave a fading "?" where they were last seen. The AI plays by the same rules.
- **Ganimi kava:** a regiment that lies unseen for a few seconds and then strikes springs an **ambush**: a heavy shock to the target's morale and harder blows for a few seconds (Mavalas most of all). Cavalry can **feign flight** (F): they gallop off as if beaten, enemies who give chase lose their order and are easier to cut up, and after a few seconds the riders wheel about. The AI hides hill troops and light horse in woods when it defends.
- **Formations:** open order, tight block (holds charges and steadies morale, but slow, clumsy in woods, and shot to pieces by guns), loose order (arrows do far less harm and woods are easy going, but a charge rides straight through), spear hedge (cavalry and elephants break on it, but it can't move), and cavalry wedge (a much heavier charge, thin flanks). Keys N, T, L, B, G or the Orders panel.
- **Fatigue:** marching, running, climbing and fighting tire regiments; tired men move slower, hit softer and break sooner. Resting recovers them.
- **Ammunition:** archers and gunners carry limited arrows and powder and must go back to the baggage at their own edge of the field to refill. Garrisons on their walls draw on the fort's magazine.
- **Elephants panic:** rockets, guns and spear points frighten them; past a point they run amok through whoever is near, their own side included, until they calm or the mahout kills the beast.
- **Rally and veterans:** routed regiments near the commander's standard rally sooner, and twice. **R** sends the commander along the line: nearby regiments steady and routed ones turn back (every 45 seconds). Regiments earn experience (Seasoned, Veteran, Elite chevrons) that makes them steadier and deadlier; raw recruits dilute it.
- **Weather and time of day:** rain brings mud and wet powder; morning mist cuts sight until it lifts; a battle joined late in the day ends at nightfall in a draw if neither side has broken.
- **Commanders:** each side's commander shapes the battle through his rank and trait (bold charges, cautious defence, horseman's cavalry, and so on).
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
| `src/battle/scene.ts` | Battle controls, 2D rendering, the overlay drawn over the 3D view, and results |
| `src/battle/view3d.ts` | The 3D battlefield (Babylon.js): terrain, trees, houses, walls, soldiers, camera, picking and projection |
| `src/campaign/paths.ts` | Free movement: A* over the land grid, straightened into direct marches |
| `src/campaign/map3d.ts` | The 3D campaign map (Babylon.js): relief, the painted map as its skin, sea, settlements, marching companies, camera and picking |
| `src/three/engine.ts`, `src/three/textures.ts` | The shared WebGL engine, and procedural textures (ground grain, water ripples, stone, plaster) |
| `src/pref3d.ts` | The 3D/2D preference and WebGL check (no Babylon, so it stays out of the main bundle) |

It's TypeScript built with Vite. The campaign map and the battlefield are 3D with Babylon.js, loaded after the page appears so the game starts at once; names, banners, orders and effects are drawn on a 2D canvas laid over the 3D view, which also takes all input. Everything still works in 2D.
