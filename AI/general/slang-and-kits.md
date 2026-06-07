# Rust Slang, Abbreviations & Gear Kits

This document translates player slang, abbreviations and "kit"/"set" terms into
the exact in-game item names the bot's data uses. When a user uses slang, map it
to the real name(s) here, then look up each item with get_item.

## Weapon slang → item name
- ak, ak47, ak-47 → Assault Rifle
- bolty, bolt, bar → Bolt Action Rifle
- l9, l96, awp → L96 Rifle
- mp5 → MP5A4
- tommy → Thompson
- sar, semi → Semi-Automatic Rifle
- p2, p250, semi pistol → Semi-Automatic Pistol   (NOTE: P2 is the semi-auto PISTOL, not the Python)
- python, pythy → Python Revolver
- revy, revvy → Revolver
- m2, lmg → M249
- m9, m92 → M92 Pistol
- lr, lr300 → LR-300 Assault Rifle
- m39 → M39 Rifle
- sks → SKS
- db, double barrel → Double Barrel Shotgun
- pump, pumpy → Pump Shotgun
- spas → Spas-12 Shotgun
- waterpipe → Waterpipe Shotgun
- eoka → Eoka Pistol
- nailgun → Nailgun
- crossy, crossbow → Crossbow
- hmlmg → HMLMG
- minigun → Minigun
- prim → primitive gear (bow, eoka, crossbow, burlap)

## Weapon attachments slang → item name
- holo, holosight → Holosight
- 8x, scope → 8x Zoom Scope
- zoom → Variable Zoom Scope
- sight, handmade sight → Simple Handmade Sight
- laser → Weapon Lasersight
- ext mag, extendo, extended → Extended Magazine
- silencer, can, suppressor → Silencer
- muzzle boost → Muzzle Boost
- muzzle brake → Muzzle Brake
- flashlight → Weapon flashlight

## Ammo slang → item name
- explo, explo ammo, explosive ammo → Explosive 5.56 Rifle Ammo
- hv, hv rocket → High Velocity Rocket
- rocket, rpg → Rocket
- c4, timed → Timed Explosive Charge
- satchel → Satchel Charge
- beancan → Beancan Grenade
- nades → F1 Grenade / Beancan Grenade
- pistol ammo, 5.56, hv pistol → (match by name)

## Armor / clothing slang → item name
- facemask, fmask → Metal Facemask
- chest, chestplate, metal chest → Metal Chest Plate
- coffee can → Coffee Can Helmet
- roadsign kilt → Road Sign Kilt
- roadsign vest, roadsign → Road Sign Jacket
- roadsign gloves, tactical gloves → Roadsign Gloves
- hoodie → Hoodie
- pants → Pants
- boots → Boots
- hazzy, hazmat → Hazmat Suit
- wood armor → Wood Chestplate + Wood Armor Pants
- bone armor → Bone Armor

## Resource slang → item name
- frags, metal frags → Metal Fragments
- hqm → High Quality Metal
- sulf → Sulfur
- gp, gunpowder → Gun Powder
- low grade, lgf → Low Grade Fuel
- scrap → Scrap
- ore → Metal Ore / Sulfur Ore (by context)

## Monument slang → monument name
Used to interpret where events/players are (e.g. "heli at oil", "anyone at launch").
- smoil, small oil, soil → Small Oil Rig
- oil, loil, large oil, big oil → Large Oil Rig
- launch, ls → Launch Site
- ty, train, trainyard → Trainyard
- power, pp, powerplant → Power Plant
- water, wt, water treatment → Water Treatment Plant
- dome → The Dome
- sat, satdish, sat dish → Satellite Dish
- af, airfield → Airfield
- tuns, tunnels, mil tunnels, military tunnels → Military Tunnels
- excav, excavator → Giant Excavator Pit
- arctic, arctic base → Arctic Research Base
- nuke, silo, missile silo → Missile Silo
- amb, mil base → Abandoned Military Base
- bandit, bandit camp → Bandit Camp
- outpost, safezone, compound → Outpost
- ferry, ferry terminal → Ferry Terminal
- harbor, harbour → Harbor
- sewer, sewers → Sewer Branch
- junkyard, jy → Junkyard
- gas, gas station, oxums → Oxum's Gas Station
- super, supermarket, mini → mini monument (Supermarket)
- fishing, fishing village → Fishing Village
- stables → Stables

## Event slang → marker / event
- cargo, cs → Cargo Ship
- heli, patrol, pheli → Patrol Helicopter
- brad, bradley, tank → Bradley APC (Launch Site)
- chinook, ch47, ch → CH47 Chinook (drops hackable crate)
- crate, hack, hackable, locked crate → Hackable Locked Crate

## Base / player / raiding slang
- tc → Tool Cupboard
- core → area around the TC
- honeycomb, hc → extra wall layers around the core
- bunker → sealed-core base technique
- fob → forward/raid base
- zerg → large clan
- wb, workbench, wb1/wb2/wb3 → Workbench Level 1/2/3
- bp → blueprint
- full kit, geared, heavy → fully armoured (metal/heavy plate)
- naked → no gear
- grub → low-gear player
- eco → cheap option (use cheapest method, NOT siege/eco-raid unless asked)
- online/offline raid → raid timing, no item change

## Gear "kits" / "sets" — component lists
A "kit" or "set" = several items. Look up and sum each component's craft cost,
then multiply by the requested quantity.

### AK kit (standard)
- Assault Rifle
- Holosight
- Weapon Lasersight
- Extended Magazine
- (ammo separate unless asked)

### Full metal kit / metal kit (standard)
- Metal Facemask
- Metal Chest Plate
- Hoodie
- Pants
- Boots

### Roadsign kit (mid-tier armor)
- Coffee Can Helmet
- Road Sign Jacket
- Road Sign Kilt
- Hoodie / Pants / Boots

<!-- ============================================================
     EDIT ME — group-specific slang & kit definitions
     Add or correct your team's own terms and exact kit contents
     below. The bot reads this file, so anything here is used.
     e.g.:
       - "fat kit" = Assault Rifle + Holosight + 2x Extended Magazine + full metal + meds
       - "roam kit" = MP5A4 + Holosight + coffee-can armor
     ============================================================ -->
