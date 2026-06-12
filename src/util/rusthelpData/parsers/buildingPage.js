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

const Cheerio = require('cheerio');
const Rsc = require('./rscExtractor.js');
const RaidTable = require('./raidTable.js');
const ItemExtras = require('./itemExtras.js');

/**
 *  Derive the display name and slug for a building/world page.
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL or path (used to derive the slug).
 *  @return {{ name: string, slug: string }|null} The display name + slug, or null.
 */
function parseNameAndSlug(html, pageUrl) {
    const $ = Cheerio.load(html);
    const name = ($('h1').first().text() || '').trim();
    if (!name) return null;
    const slug = pageUrl.replace(/^.*\/(building|world)\//, '').replace(/[#?].*$/, '').replace(/\/$/, '');
    return { name, slug };
}

/**
 *  Extract the per-day upkeep cost component ([{ itemLink, min, max }]).
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|null} [{ name, min, max }] or null.
 */
function parseUpkeep(payload) {
    const datas = Rsc.findComponentData(payload, '"columnName":"Upkeep Cost (per day)"');
    for (const data of datas) {
        if (!Array.isArray(data)) continue;
        const entries = [];
        for (const row of data) {
            const name = ItemExtras.linkName(row && row.itemLink);
            if (name && typeof row.min === 'number') {
                entries.push({ name, min: row.min, max: typeof row.max === 'number' ? row.max : row.min });
            }
        }
        if (entries.length > 0) return entries;
    }
    return null;
}

/**
 *  Extract the build cost component ([{ itemLink, amount }]).
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|null} [{ name, quantity }] or null.
 */
function parseBuildCost(payload) {
    const datas = Rsc.findComponentData(payload, '"columnName":"Build Cost"');
    for (const data of datas) {
        const cost = ItemExtras.mapCosts(data);
        if (cost) return cost;
    }
    return null;
}

/**
 *  Extract the repair component ({ repairItemLink, hammerSwings, maxRepairCost, ... }).
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|null} { tool, cost, conditionLossPercent?, needsBlueprint? } or null.
 */
function parseRepair(payload) {
    const datas = Rsc.findComponentData(payload, '"columnName":"Max Repair Cost"');
    for (const data of datas) {
        if (!data || typeof data !== 'object') continue;
        const cost = ItemExtras.mapCosts(data.maxRepairCost);
        if (!cost) continue;
        return {
            tool: ItemExtras.linkName(data.repairItemLink) || data.repairItemId || 'Hammer',
            cost,
            conditionLossPercent: typeof data.maxConditionLostPercent === 'number'
                ? data.maxConditionLostPercent : undefined,
            needsBlueprint: data.needBlueprint === true ? true : undefined
        };
    }
    return null;
}

/**
 *  Parse a building page into name/slug, hp, rich durability records and extras
 *  (build cost, per-day upkeep, repair cost).
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL/path.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} { name, slug, hp, durability, buildCost, upkeep, repair } or null.
 */
function parseBuildingPage(html, pageUrl, resolver) {
    const meta = parseNameAndSlug(html, pageUrl);
    if (!meta) return null;

    const payload = Rsc.decodeRscPayload(html);
    const building = payload ? Rsc.extractBuildingObject(payload) : null;

    const result = {
        name: meta.name,
        slug: meta.slug,
        hp: null,
        durability: [],
        buildCost: null,
        upkeep: null,
        repair: null
    };

    if (building && typeof building.maxHealth === 'number' && building.maxHealth > 0) {
        result.hp = building.maxHealth;
    }
    if (building && building.raidingTable) {
        result.durability = RaidTable.buildDurabilityRecords(building.raidingTable, resolver, payload);
    }
    if (payload) {
        result.buildCost = parseBuildCost(payload);
        result.upkeep = parseUpkeep(payload);
        result.repair = parseRepair(payload);
    }

    return result;
}

module.exports = { parseBuildingPage, parseNameAndSlug };
