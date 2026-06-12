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
    Parses rusthelp /world/ entity pages (crates, barrels, NPCs, animals, ore nodes,
    collectables, trees). Beyond the building-page raid table these carry:
    - loot:    full drop tables with per-item chances (crates, barrels, scientists)
    - harvest: per-tool harvesting yields (animals, trees, nodes)
    - contains: flat pickup yields (collectables)
    - foundAt: which monuments spawn the entity and how many
*/

const BuildingPage = require('./buildingPage.js');
const Rsc = require('./rscExtractor.js');
const ItemExtras = require('./itemExtras.js');

const MAX_LOOT_ENTRIES = 30;
const MAX_FOUND_AT = 12;

/**
 *  Enumerate every parsable `"data":` component value in the payload.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array} Parsed component data values.
 */
function enumerateDataComponents(payload) {
    const out = [];
    let idx = 0;
    while ((idx = payload.indexOf('"data":', idx)) !== -1) {
        const raw = Rsc.extractBalancedValue(payload, idx + '"data":'.length);
        idx += '"data":'.length;
        if (!raw || raw.length < 20) continue;
        try {
            out.push(JSON.parse(raw));
        } catch (error) {
            /* Component data with unresolved $refs; skip. */
        }
    }
    return out;
}

/**
 *  Render one loot entry's item bundle ("Double Barrel Shotgun + 12 Gauge Buckshot x5").
 *  @param {Array} items The entry's items ([{ itemLink, min, max, isBlueprint? }]).
 *  @return {{ name: string, amount: string }|null}
 */
function renderLootItems(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const parts = [];
    let amount = null;
    for (const item of items) {
        let name = ItemExtras.linkName(item && item.itemLink);
        if (!name) continue;
        if (item.isBlueprint === true) name += ' (Blueprint)';
        const min = typeof item.min === 'number' ? item.min : 1;
        const max = typeof item.max === 'number' ? item.max : min;
        const amountStr = min === max ? String(min) : `${min}-${max}`;
        if (amount === null) amount = amountStr;
        else if (amountStr !== '1') name += ` x${amountStr}`;
        parts.push(name);
    }
    if (parts.length === 0) return null;
    return { name: parts.join(' + '), amount: amount || '1' };
}

/**
 *  Extract the entity drop table from the page's embedded entity object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|undefined} { entries: [{ name, amount, chancePercent }], totalEntries } or undefined.
 */
function buildLoot(payload) {
    const idx = payload.indexOf('"hasLoot":true');
    if (idx === -1) return undefined;
    const objStart = payload.lastIndexOf('{"prefab"', idx);
    if (objStart === -1) return undefined;
    const raw = Rsc.extractBalancedObject(payload, objStart);
    if (!raw) return undefined;

    let entity;
    try {
        entity = JSON.parse(raw);
    } catch (error) {
        return undefined;
    }
    const loot = ItemExtras.resolveField(entity.loot, payload);
    if (!Array.isArray(loot) || loot.length === 0) return undefined;

    const entries = [];
    for (const entry of loot) {
        const rendered = renderLootItems(entry && entry.items);
        if (!rendered) continue;
        const chance = typeof entry.chanceForAtLeastOne === 'number' ? entry.chanceForAtLeastOne : 1;
        entries.push({
            name: rendered.name,
            amount: rendered.amount,
            chancePercent: Math.round(chance * 1000) / 10
        });
    }
    if (entries.length === 0) return undefined;
    const sorted = [...entries].sort((a, b) => b.chancePercent - a.chancePercent);
    return {
        entries: sorted.slice(0, MAX_LOOT_ENTRIES),
        totalEntries: sorted.length
    };
}

/**
 *  Classify the enumerated components into harvest / contains / foundAt tables.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object} Partial result ({ harvest?, contains?, foundAt? }).
 */
function buildComponentTables(payload) {
    const result = {};
    for (const data of enumerateDataComponents(payload)) {
        if (!Array.isArray(data) || data.length === 0) continue;
        const probe = data[0];
        if (!probe || typeof probe !== 'object') continue;

        /* Harvesting rows: { toolItemId, tool, secondsTaken, itemsToReceive }. */
        if (!result.harvest && Object.prototype.hasOwnProperty.call(probe, 'toolItemId')) {
            const rows = [];
            for (const row of data) {
                const tool = ItemExtras.linkName(ItemExtras.resolveField(row.tool, payload));
                const yields = ItemExtras.mapCosts(
                    ItemExtras.resolveField(row.itemsToReceive, payload) || []);
                if (!tool || !yields) continue;
                const entry = { tool, yields };
                if (typeof row.secondsTaken === 'number' && row.secondsTaken > 0) {
                    entry.seconds = row.secondsTaken;
                }
                rows.push(entry);
            }
            if (rows.length > 0) result.harvest = rows;
            continue;
        }

        /* Found-at rows: { entityId, entityLink, minAmount, maxAmount }. */
        if (!result.foundAt && Object.prototype.hasOwnProperty.call(probe, 'minAmount') &&
            Object.prototype.hasOwnProperty.call(probe, 'entityId')) {
            const rows = [];
            for (const row of data) {
                const name = ItemExtras.linkName(ItemExtras.resolveField(row.entityLink, payload));
                if (!name) continue;
                const min = typeof row.minAmount === 'number' ? row.minAmount : 1;
                const max = typeof row.maxAmount === 'number' ? row.maxAmount : min;
                rows.push({ name, amount: min === max ? String(min) : `${min}-${max}` });
            }
            if (rows.length > 0) result.foundAt = rows.slice(0, MAX_FOUND_AT);
            continue;
        }

        /* Pickup yields (collectables): { itemId, itemLink, amount } and nothing else. */
        if (!result.contains && Object.prototype.hasOwnProperty.call(probe, 'itemId') &&
            Object.prototype.hasOwnProperty.call(probe, 'amount') &&
            !Object.prototype.hasOwnProperty.call(probe, 'min')) {
            const rows = ItemExtras.mapCosts(data);
            if (rows) result.contains = rows;
        }
    }
    return result;
}

/**
 *  Parse a world entity page. Shares the building page's name/slug/hp/durability shape and
 *  adds loot / harvest / contains / foundAt knowledge.
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL/path.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} The parsed page, or null.
 */
function parseWorldPage(html, pageUrl, resolver) {
    const base = BuildingPage.parseBuildingPage(html, pageUrl, resolver);
    if (!base) return null;

    const payload = Rsc.decodeRscPayload(html);
    if (!payload) return base;

    const result = { ...base };
    const loot = buildLoot(payload);
    if (loot) result.loot = loot;
    Object.assign(result, buildComponentTables(payload));

    /* The build-cost component shares the contains row signature — drop the false match. */
    if (result.contains && base.buildCost &&
        JSON.stringify(result.contains) === JSON.stringify(base.buildCost)) {
        delete result.contains;
    }
    return result;
}

module.exports = { parseWorldPage };
