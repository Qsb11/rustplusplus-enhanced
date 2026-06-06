# Electricity Basics

Power sources:
- Small Solar Panel: up to 20 power, daytime only, needs sun angle
- Wind Turbine: 0-150 power, varies with height + wind
- Small Generator (fuel): 40 power, drinks low grade
- Test Generator (admin): 100 power
- Large Solar/Battery farm: combine via Root Combiner

Storage:
- Small Battery: 10 power out, 150 Wh
- Medium Battery: 50 power out, 2400 Wh
- Large Battery: 100 power out, 4800 Wh
- Batteries charge at 80% efficiency. Chain root combiners into batteries.

Core components:
- Splitter: splits input into 3 equal outputs
- Branch: splits off an EXACT configurable amount, passthrough the rest
- Root Combiner: combines power sources (same type) into one line
- Memory Cell: 1-bit storage — set/reset/toggle, the building block of logic
- Smart Switch: remote on/off via Rust+ app (pairs with this bot!)
- Smart Alarm: sends notification when powered (pairs with this bot!)
- HBHF Sensor: detects players, outputs count as power
- Electrical Branch + Igniter/Heater, Door Controller: door automation

Common circuits:
- Auto door closer: HBHF sensor -> Door Controller with timer
- Raid alarm: HBHF (outsiders only) -> Smart Alarm -> phone notification
- Battery backup: Solar -> Battery -> Branch (keeps battery topped, rest to base)
- Toggle light switch: Switch -> Memory Cell TOGGLE input -> lights
- Garage door stacker: one Door Controller per door, same power line via splitter

Tips:
- Power = capacity, not consumption: a line "carries" its number; components
  reserve their draw in order of connection.
- Use Branch with exact amounts to guarantee critical systems (turrets first).
- Auto Turret draws 10, Smart Switch 1, Door Controller 1, HBHF 1.
