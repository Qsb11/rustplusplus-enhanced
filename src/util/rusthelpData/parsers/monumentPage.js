/*
    Copyright (C) 2024 Nuallan Lampe (BigFatherJesus)
    Enhanced fork of rustplusplus by Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

/*
    Parses rusthelp /monument/ pages. Three RSC data components matter:
    - puzzle:   [{ requirementsBring, requirementsUse, resetTimeMinutes, spawns }]
    - features: [{ key, translatedKey, amount, associatedEntityLink }]  (recycler, repair bench, ...)
    - spawns:   [{ entity, amount, minRespawnDelayMinutes, maxRespawnDelayMinutes }]  (crates, NPCs)

    rusthelp does not publish radiation levels, so those cannot be scraped here.
*/

const Cheerio = require('cheerio');
const Rsc = require('./rscExtractor.js');
const ItemExtras = require('./itemExtras.js');

/**
 *  Find the parsed "data" array of the component containing a distinctive key marker.
 *  @param {string} payload The decoded RSC payload.
 *  @param {string} marker A key that appears inside the component's data rows.
 *  @return {Array|null} The parsed data array, or null.
 */
function findDataByRowKey(payload, marker) {
    let idx = 0;
    while ((idx = payload.indexOf(marker, idx)) !== -1) {
        const dataIdx = payload.lastIndexOf('"data":', idx);
        idx += marker.length;
        if (dataIdx === -1) continue;
        const raw = Rsc.extractBalancedValue(payload, dataIdx + '"data":'.length);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (error) {
            /* Component data with unresolved $refs is not standalone JSON; skip. */
        }
    }
    return null;
}

/**
 *  Map a requirements list ([{ entityLink, amount }]) to [{ name, quantity }].
 *  @param {Array|null} list The requirement entries.
 *  @param {string} payload The decoded RSC payload (for $ref entityLinks).
 *  @return {Array|undefined}
 */
function mapRequirements(list, payload) {
    if (!Array.isArray(list)) return undefined;
    const out = [];
    for (const entry of list) {
        const link = ItemExtras.resolveField(entry && entry.entityLink, payload);
        const name = ItemExtras.linkName(link);
        if (name) out.push({ name, quantity: typeof entry.amount === 'number' ? entry.amount : 1 });
    }
    return out.length > 0 ? out : undefined;
}

/**
 *  Build the puzzle summary from the puzzle component.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|undefined} { bring, use, resetMinutes } or undefined.
 */
function buildPuzzle(payload) {
    const data = findDataByRowKey(payload, '"requirementsBring"');
    if (!data) return undefined;
    for (const entry of data) {
        const bring = mapRequirements(entry.requirementsBring, payload);
        if (!bring) continue;
        const puzzle = { bring };
        const use = mapRequirements(entry.requirementsUse, payload);
        if (use) puzzle.use = use;
        if (typeof entry.resetTimeMinutes === 'number' && entry.resetTimeMinutes > 0) {
            puzzle.resetMinutes = entry.resetTimeMinutes;
        }
        return puzzle;
    }
    return undefined;
}

/* Feature keys worth surfacing to players, mapped to friendly names. */
const FEATURE_NAME_MAP = {
    'recycler-static': 'Recycler',
    'repairbench-static': 'Repair Bench',
    'researchtable-static': 'Research Table',
    'small-refinery-static': 'Small Oil Refinery',
    'workbench1-static': 'Workbench Level 1',
    'workbench2-static': 'Workbench Level 2',
    'workbench3-static': 'Workbench Level 3',
    'mixingtable-static': 'Mixing Table',
    'vendingmachine-static': 'Vending Machine',
    'phonebooth-static': 'Telephone',
    'elevator-lift-static': 'Elevator',
    'ceilinglight-static': null,
    'chair-static': null,
    'hobobarrel': null,
    'fireplace-static': null
};

/**
 *  Build the notable-features list (recycler, repair bench, ...) from the features component.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|undefined} [{ name, amount }] or undefined.
 */
function buildFeatures(payload) {
    const data = findDataByRowKey(payload, '"translatedKey"');
    if (!data) return undefined;
    const out = [];
    for (const entry of data) {
        if (!entry || typeof entry !== 'object') continue;
        let name = typeof entry.translatedKey === 'string' && entry.translatedKey !== entry.key
            ? entry.translatedKey : null;
        if (!name && typeof entry.key === 'string') {
            if (Object.prototype.hasOwnProperty.call(FEATURE_NAME_MAP, entry.key)) {
                name = FEATURE_NAME_MAP[entry.key];
                if (name === null) continue; /* Cosmetic clutter (chairs, barrels, ...). */
            }
            else {
                /* Unknown raw key — prettify ("water-pump-static" -> "Water Pump Static"). */
                name = entry.key.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
        }
        if (!name) continue;
        out.push({ name, amount: typeof entry.amount === 'number' ? entry.amount : 1 });
    }
    return out.length > 0 ? out : undefined;
}

/**
 *  Build the loot/NPC spawn list from the spawns component.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|undefined} [{ name, amount, respawnMinutes? }] or undefined.
 */
function buildSpawns(payload) {
    const data = findDataByRowKey(payload, '"minRespawnDelayMinutes"');
    if (!data) return undefined;
    const out = [];
    for (const entry of data) {
        if (!entry || typeof entry !== 'object') continue;
        let name = null;
        if (entry.entity) {
            const link = ItemExtras.resolveField(entry.entity.entityLink, payload);
            name = ItemExtras.linkName(link);
        }
        else if (Array.isArray(entry.spawnOptions)) {
            /* Spawn point shared by several entities (e.g. oil/yellow/blue barrels) —
               list the variants ordered by spawn chance. */
            const options = [...entry.spawnOptions]
                .sort((a, b) => (b.chance || 0) - (a.chance || 0))
                .map(o => ItemExtras.linkName(ItemExtras.resolveField(o.entity && o.entity.entityLink, payload)))
                .filter(Boolean);
            if (options.length > 0) name = options.slice(0, 3).join(' / ');
        }
        if (!name) continue;
        const spawn = { name, amount: typeof entry.amount === 'number' ? entry.amount : 1 };
        if (typeof entry.minRespawnDelayMinutes === 'number' && entry.minRespawnDelayMinutes > 0) {
            spawn.respawnMinutes = entry.minRespawnDelayMinutes === entry.maxRespawnDelayMinutes
                ? String(entry.minRespawnDelayMinutes)
                : `${entry.minRespawnDelayMinutes}-${entry.maxRespawnDelayMinutes}`;
        }
        out.push(spawn);
    }
    return out.length > 0 ? out : undefined;
}

/**
 *  Parse a monument page.
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL/path (used to derive the slug).
 *  @return {Object|null} { name, slug, puzzle?, features?, spawns? } or null.
 */
function parseMonumentPage(html, pageUrl) {
    const $ = Cheerio.load(html);
    const name = ($('h1').first().text() || '').trim();
    if (!name) return null;
    const slug = pageUrl.replace(/^.*\/monument\//, '').replace(/[#?].*$/, '').replace(/\/$/, '');

    const payload = Rsc.decodeRscPayload(html);
    const result = { name, slug };
    if (!payload) return result;

    const puzzle = buildPuzzle(payload);
    if (puzzle) result.puzzle = puzzle;

    const features = buildFeatures(payload);
    if (features) result.features = features;

    const spawns = buildSpawns(payload);
    if (spawns) result.spawns = spawns;

    return result;
}

module.exports = { parseMonumentPage };
