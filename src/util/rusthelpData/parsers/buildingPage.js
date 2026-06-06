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
const TimeFormat = require('./timeFormat.js');

/* Map a rusthelp raid damageType to the bot durability group. */
const DAMAGE_GROUP_MAP = {
    'explosive': 'explosive',
    'melee': 'melee',
    'throw': 'throw',
    'gun': 'guns',
    'guns': 'guns',
    'torpedo': 'torpedo',
    'turret': 'turret'
};

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
 *  Build durability records (explosive/raid) from a building's raidingTable data.
 *  @param {Object} building The extracted building object (with raidingTable.data).
 *  @param {Object} resolver The IdResolver.
 *  @return {Array<Object>} An array of durability records (may be empty).
 */
function buildDurabilityRecords(building, resolver) {
    const records = [];
    const data = building && building.raidingTable && Array.isArray(building.raidingTable.data)
        ? building.raidingTable.data : [];
    for (const row of data) {
        const toolId = resolver.resolve(row.itemLink || { id: row.itemId });
        if (!toolId) continue;
        const group = DAMAGE_GROUP_MAP[row.damageType] || 'explosive';
        let sulfur = null;
        if (Array.isArray(row.rawCraftCost)) {
            const s = row.rawCraftCost.find(c => c.itemLink && c.itemLink.displayName === 'Sulfur');
            if (s) sulfur = s.amount;
        }
        const time = typeof row.secondsTaken === 'number' ? row.secondsTaken : 0;
        records.push({
            group,
            which: null,
            toolId,
            caption: null,
            quantity: typeof row.requiredItems === 'number' ? row.requiredItems : 0,
            quantityTypeId: null,
            time,
            timeString: TimeFormat.formatDurabilityTime(time),
            fuel: null,
            sulfur
        });
    }
    return records;
}

/**
 *  Parse a building page.
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL/path.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} { name, slug, hp, durability } or null.
 */
function parseBuildingPage(html, pageUrl, resolver) {
    const meta = parseNameAndSlug(html, pageUrl);
    if (!meta) return null;

    const payload = Rsc.decodeRscPayload(html);
    const building = payload ? Rsc.extractBuildingObject(payload) : null;

    const result = { name: meta.name, slug: meta.slug, hp: null, durability: [] };

    if (building && typeof building.maxHealth === 'number' && building.maxHealth > 0) {
        result.hp = building.maxHealth;
    }
    if (building) {
        result.durability = buildDurabilityRecords(building, resolver);
    }

    return result;
}

module.exports = { parseBuildingPage, parseNameAndSlug, buildDurabilityRecords };
