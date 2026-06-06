# Siege Weapons (Primitive update and later)

Rust added dedicated siege weapons — often far cheaper per structure HP than
explosives, at the cost of being slow, loud and physically exposed.

## Catapult
- Deployable siege weapon, can be towed by horses.
- Ammo types:
  - Boulder: very cheap (stone), decent structure damage — the eco option
  - Firebomb: area fire damage, good vs wood and exposed players
  - Propane Explosive Bomb: heavy structure damage, the main raid projectile
  - Bee Catapult Bomb: area denial — bees attack defenders
- Eco profile: boulders cost almost nothing; propane bombs are far cheaper
  per damage than rockets/C4 for stone-tier targets. Exact craft costs are in
  the per-item data files (AI/items/).
- Weaknesses: arc trajectory needs line-of-sight space, stationary while
  firing, operator exposed.

## Ballista / Mounted Ballista
- Fires ballista bolts (piercer-style bolts vs vehicles/armor, hammerhead vs
  structures).
- Better against vehicles, horses and deployables than against high-tier walls.
- Mounted (static base-defense) and towable field variants.

## Battering Ram
- Drivable siege vehicle with a swinging ram head (Battering Ram Head item
  is the repair/replacement part).
- Smashes doors and lower-tier walls by repeated hits — costs fuel + repair
  materials instead of sulfur. Extremely eco vs doors if you can drive up to
  them.
- Counter: vertical/elevated bases, ditches, high externals.

## Siege Tower
- Mobile wooden tower — pushed against walls so raiders climb over high
  externals or onto roofs. Bypasses walls entirely instead of breaking them.
- Costs only building resources. Counter is distance/terrain, turrets and
  roof control.

## Cannon
- Fires Cannonballs. Strong single-target structure damage at range.

## When siege beats explosives
- Stone-tier targets and compounds: catapult propane bombs / boulders usually
  out-eco rockets by a wide margin.
- Door-stack bases reachable by vehicle: battering ram.
- High external walls: siege tower (bypass, zero destruction cost).
- High-tier (sheet metal/armored) cores still usually need explosives.

Exact ingredient lists, sulfur equivalents and damage numbers: check the
per-item JSON files in AI/items/ (Catapult, Propane Explosive Bomb, Firebomb,
Ballista, Battering Ram, Siege Tower, Cannonball, ...).
