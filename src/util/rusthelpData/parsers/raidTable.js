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
    Converts rusthelp raidingTable / deployableInfo.durability rows into the legacy
    rustlabsDurabilityData record shape consumed by RustLabs.js and aiExport:
    { group, which, toolId, caption, quantity, quantityTypeId, time, timeString, fuel, sulfur }

    A rusthelp row carries the weapon (itemLink), optional ammo (bullet), the side
    (damageModifier: 'hard' | 'soft' | null), seconds taken, required item count and the
    per-craft raw resource cost (rawCraftCost, yielding craftReceivesAmount units per craft).
*/

const TimeFormat = require('./timeFormat.js');
const Rsc = require('./rscExtractor.js');

/* Map a rusthelp damageType to the bot durability group. */
const DAMAGE_GROUP_MAP = {
    'explosive': 'explosive',
    'melee': 'melee',
    'throw': 'throw',
    'bullet': 'guns',
    'gun': 'guns',
    'guns': 'guns',
    'torpedo': 'torpedo',
    'turret': 'turret'
};

/* Above this count a method is a theoretical fill-in, not a usable raid option. */
const MAX_SANE_QUANTITY = 1000000;

/**
 *  Sum the raw per-unit cost of one resource across a row's rawCraftCost and scale it
 *  to the total quantity required (rawCraftCost is per craft of craftReceivesAmount units).
 *  @param {Object} row The raid row.
 *  @param {string} resourceName The resource displayName (e.g. "Sulfur").
 *  @return {number|null} The rounded total cost, or null when the resource is not used.
 */
function totalResourceCost(row, resourceName) {
    const rawCraftCost = row.rawCraftCost;
    if (!Array.isArray(rawCraftCost) || typeof row.requiredItems !== 'number') return null;
    const receives = (typeof row.craftReceivesAmount === 'number' && row.craftReceivesAmount > 0)
        ? row.craftReceivesAmount : 1;
    let perCraft = 0;
    for (const cost of rawCraftCost) {
        const name = cost && cost.itemLink && cost.itemLink.displayName;
        if (name === resourceName && typeof cost.amount === 'number') perCraft += cost.amount;
    }
    if (perCraft === 0) return null;
    return Math.round((perCraft / receives) * row.requiredItems);
}

/**
 *  Derive the record caption: the ammo display name when the row uses ammo, otherwise the
 *  human translation of extraInfoKey (e.g. "TorchLit" -> "Torch (lit)").
 *  @param {Object} row The raid row.
 *  @param {Object} translations Map of extraInfoKey -> human text.
 *  @return {string|null} The caption, or null.
 */
function deriveCaption(row, translations) {
    if (row.bullet && typeof row.bullet.displayName === 'string') return row.bullet.displayName;
    if (typeof row.extraInfoKey === 'string' && row.extraInfoKey !== '') {
        return translations[row.extraInfoKey] || row.extraInfoKey;
    }
    return null;
}

/**
 *  Build the extraInfoKey -> human text map from a raidingTable.
 *  @param {Object|null} raidingTable The raidingTable object ({ data, copy, extraInfoTranslations }).
 *  @return {Object} The translation map (possibly empty).
 */
function buildTranslationMap(raidingTable) {
    const map = {};
    const list = raidingTable && Array.isArray(raidingTable.extraInfoTranslations)
        ? raidingTable.extraInfoTranslations : [];
    for (const entry of list) {
        if (entry && typeof entry.name === 'string' && typeof entry.value === 'string') {
            map[entry.name] = entry.value;
        }
    }
    return map;
}

/**
 *  Resolve raid row fields that the RSC stream deduplicated into "$row:path" references
 *  (rawCraftCost, bullet, itemLink all dedupe against earlier identical rows).
 *  @param {Object} row The raid row.
 *  @param {string} payload The decoded RSC payload ('' disables resolution).
 *  @return {Object} A copy of the row with reference fields resolved where possible.
 */
function resolveRowRefs(row, payload) {
    if (!payload) return row;
    const resolved = { ...row };
    for (const key of ['rawCraftCost', 'craftCost', 'bullet', 'itemLink', 'item']) {
        if (typeof resolved[key] === 'string' && resolved[key].startsWith('$')) {
            const value = Rsc.resolveReference(payload, resolved[key]);
            if (value) resolved[key] = value;
        }
    }
    return resolved;
}

/**
 *  Convert one rusthelp raid row into a legacy durability record.
 *  @param {Object} rawRow The raid row.
 *  @param {Object} resolver The IdResolver.
 *  @param {Object} translations extraInfoKey translation map.
 *  @param {string} [payload] The decoded RSC payload for reference resolution.
 *  @return {Object|null} The record, or null when the tool cannot be resolved / row is junk.
 */
function rowToRecord(rawRow, resolver, translations, payload = '') {
    if (!rawRow || typeof rawRow !== 'object') return null;
    const row = resolveRowRefs(rawRow, payload);
    const toolId = resolver.resolve(row.itemLink || row.item || { id: row.itemId });
    if (!toolId) return null;

    const quantity = typeof row.requiredItems === 'number' ? row.requiredItems : 0;
    if (quantity <= 0 || quantity > MAX_SANE_QUANTITY) return null;

    const group = DAMAGE_GROUP_MAP[row.damageType] ||
        (typeof row.damageType === 'string' ? row.damageType : 'explosive');
    const which = row.damageModifier === 'hard' || row.damageModifier === 'soft'
        ? row.damageModifier : 'both';
    const time = typeof row.secondsTaken === 'number' && row.secondsTaken >= 0
        ? Math.round(row.secondsTaken) : null;

    return {
        group,
        which,
        toolId,
        caption: deriveCaption(row, translations),
        quantity,
        quantityTypeId: null,
        time,
        timeString: time !== null ? TimeFormat.formatDurabilityTime(time) : null,
        fuel: totalResourceCost(row, 'Low Grade Fuel'),
        sulfur: totalResourceCost(row, 'Sulfur')
    };
}

/**
 *  Convert a rusthelp raidingTable (or a bare row array such as deployableInfo.durability)
 *  into legacy durability records.
 *  @param {Object|Array|null} raidingTableOrRows The raidingTable object or a bare rows array.
 *  @param {Object} resolver The IdResolver.
 *  @param {string} [payload] The decoded RSC payload for "$ref" field resolution.
 *  @return {Array<Object>} The records (possibly empty).
 */
function buildDurabilityRecords(raidingTableOrRows, resolver, payload = '') {
    const isBareArray = Array.isArray(raidingTableOrRows);
    const rows = isBareArray
        ? raidingTableOrRows
        : (raidingTableOrRows && Array.isArray(raidingTableOrRows.data) ? raidingTableOrRows.data : []);
    const translations = isBareArray ? {} : buildTranslationMap(raidingTableOrRows);

    const records = [];
    for (const row of rows) {
        const record = rowToRecord(row, resolver, translations, payload);
        if (record) records.push(record);
    }
    return records;
}

module.exports = { buildDurabilityRecords, rowToRecord, totalResourceCost, buildTranslationMap };
