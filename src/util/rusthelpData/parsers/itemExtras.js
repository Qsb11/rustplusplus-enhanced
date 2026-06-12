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
    Extracts the "extras" knowledge from a rusthelp item object: durability/condition,
    repair cost, deployable health/decay/upkeep, food values, loot sources, vending
    offers, storage details, weapon-attachment compatibility and mixing recipes.

    All item references are resolved to display names so the output is self-contained
    (written to staticFiles/rusthelpExtras.json, consumed by aiExport.js).

    Several rusthelp fields stream as RSC references ("$row:path") instead of inline
    values — resolveField() handles both forms transparently.
*/

const Rsc = require('./rscExtractor.js');

const MAX_LOOT_SOURCES = 6;
const MAX_SHOP_OFFERS = 6;
const MAX_USED_IN = 20;

/**
 *  Resolve a field that may be streamed inline or as an RSC reference string.
 *  @param {*} value The field value.
 *  @param {string} payload The decoded RSC payload.
 *  @return {*} The resolved value (or the original when it was inline), null when unresolvable.
 */
function resolveField(value, payload) {
    if (typeof value === 'string' && value.startsWith('$')) {
        return Rsc.resolveReference(payload, value);
    }
    return value;
}

/**
 *  @param {Object|null|undefined} link An itemLink/entityLink-like object.
 *  @return {string|null} Its display name.
 */
function linkName(link) {
    if (!link || typeof link.displayName !== 'string') return null;
    const name = link.displayName.trim();
    return name !== '' ? name : null;
}

/**
 *  Map a cost array ([{ itemLink, amount }]) to [{ name, quantity }].
 *  @param {Array|null} costs The cost entries.
 *  @return {Array|undefined} The mapped list, or undefined when empty.
 */
function mapCosts(costs) {
    if (!Array.isArray(costs)) return undefined;
    const out = [];
    for (const cost of costs) {
        const name = linkName(cost && cost.itemLink);
        if (name && typeof cost.amount === 'number') out.push({ name, quantity: cost.amount });
    }
    return out.length > 0 ? out : undefined;
}

/**
 *  Build the repair summary from repairInfo.waysToRepair (elements may be RSC refs).
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|undefined} { tool, cost, conditionLossPercent, needsBlueprint } or undefined.
 */
function buildRepair(item, payload) {
    const info = resolveField(item.repairInfo, payload);
    if (!info || !Array.isArray(info.waysToRepair)) return undefined;
    for (const wayRaw of info.waysToRepair) {
        const way = resolveField(wayRaw, payload);
        if (!way || typeof way !== 'object') continue;
        const cost = mapCosts(way.maxRepairCost);
        if (!cost) continue;
        return {
            tool: linkName(way.repairItemLink) || way.repairItemId || 'Hammer',
            cost,
            conditionLossPercent: typeof way.maxConditionLostPercent === 'number'
                ? way.maxConditionLostPercent : undefined,
            needsBlueprint: way.needBlueprint === true ? true : undefined
        };
    }
    return undefined;
}

/**
 *  Build deployable health / decay / upkeep fields.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object} Partial extras ({ health?, decay?, upkeep? }).
 */
function buildDeployable(item, payload) {
    const info = item.deployableInfo;
    if (!info || typeof info !== 'object') return {};
    const out = {};

    if (typeof info.health === 'number' && info.health > 0) out.health = info.health;

    const decay = resolveField(info.decay, payload);
    if (decay && Array.isArray(decay.decayTimes)) {
        const times = decay.decayTimes
            .filter(t => t && typeof t.decayTimeMinutes === 'number' && t.decayTimeMinutes > 0)
            .map(t => ({ where: t.decayType, hours: Math.round((t.decayTimeMinutes / 60) * 10) / 10 }));
        if (times.length > 0) out.decay = times;
    }

    const upkeep = resolveField(info.upkeep, payload);
    if (upkeep && typeof upkeep === 'object') {
        const name = linkName(upkeep.itemLink);
        if (name && typeof upkeep.min === 'number') {
            out.upkeep = [{ name, min: upkeep.min, max: typeof upkeep.max === 'number' ? upkeep.max : upkeep.min }];
        }
    }
    return out;
}

/**
 *  Build the consumable effect summary.
 *  @param {Object} item The rusthelp item object.
 *  @return {Object|undefined} { effects, spoilTimeHours? } or undefined.
 */
function buildConsumable(item) {
    const ce = item.consumableEffect;
    if (!ce || !Array.isArray(ce.effects) || ce.effects.length === 0) return undefined;
    const effects = ce.effects
        .filter(e => e && typeof e.name === 'string' && typeof e.value === 'number' && e.value !== 0)
        .map(e => {
            const entry = { name: e.name, value: e.value };
            if (typeof e.duration === 'number' && e.duration > 0) entry.durationSeconds = e.duration;
            return entry;
        });
    if (effects.length === 0) return undefined;
    const out = { effects };
    if (typeof ce.spoilTimeHours === 'number' && ce.spoilTimeHours > 0) out.spoilTimeHours = ce.spoilTimeHours;
    return out;
}

/**
 *  Build the top loot sources sorted by drop chance.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|undefined} [{ source, chancePercent, amount }] or undefined.
 */
function buildWhereToFind(item, payload) {
    const containers = resolveField(item.lootContainers, payload);
    if (!Array.isArray(containers) || containers.length === 0) return undefined;
    const entries = [];
    for (const c of containers) {
        const source = linkName(c && c.entityLink);
        if (!source || typeof c.chance !== 'number') continue;
        const min = typeof c.minAmount === 'number' ? c.minAmount : 1;
        const max = typeof c.maxAmount === 'number' ? c.maxAmount : min;
        entries.push({
            source,
            chancePercent: Math.round(c.chance * 10) / 10,
            amount: min === max ? String(min) : `${min}-${max}`
        });
    }
    if (entries.length === 0) return undefined;
    const sorted = [...entries].sort((a, b) => b.chancePercent - a.chancePercent);
    return sorted.slice(0, MAX_LOOT_SOURCES);
}

/**
 *  Build vending-machine offers that sell this item.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|undefined} [{ shop, price, currency, amount }] or undefined.
 */
function buildShopping(item, payload) {
    const vending = resolveField(item.vending, payload);
    if (!Array.isArray(vending) || vending.length === 0) return undefined;
    const offers = [];
    for (const machine of vending) {
        if (!machine || !Array.isArray(machine.orders)) continue;
        const monument = machine.monument && machine.monument.entityLink;
        const shop = linkName(monument) ||
            (machine.npc && linkName(machine.npc.entityLink)) || 'NPC vendor';
        for (const order of machine.orders) {
            if (!order || !order.forSale || order.forSale.itemId !== item.id) continue;
            const currency = order.currency || {};
            offers.push({
                shop,
                price: typeof currency.amount === 'number' ? currency.amount : null,
                currency: linkName(currency.itemLink) || currency.itemId || 'Scrap',
                amount: typeof order.forSale.amount === 'number' ? order.forSale.amount : 1
            });
        }
    }
    return offers.length > 0 ? offers.slice(0, MAX_SHOP_OFFERS) : undefined;
}

/**
 *  Build weapon-attachment compatibility.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|undefined} { fitsWeapons, occupies? } or undefined.
 */
function buildAttachment(item, payload) {
    const info = resolveField(item.weaponAttachmentInfo, payload);
    if (!info || !Array.isArray(info.canGoOnWeapons) || info.canGoOnWeapons.length === 0) return undefined;
    const fitsWeapons = info.canGoOnWeapons.map(w => linkName(w && w.itemLink)).filter(Boolean);
    if (fitsWeapons.length === 0) return undefined;
    const out = { fitsWeapons };
    if (Array.isArray(info.occupies) && info.occupies.length > 0) out.occupies = info.occupies;

    /* Modifiers (e.g. silencer damage penalty) sit behind a second-level ref. */
    const modifiers = resolveField(info.modifiers, payload);
    if (Array.isArray(modifiers)) {
        const stats = modifiers
            .filter(m => m && typeof m.name === 'string' && m.value !== undefined && m.value !== null)
            .map(m => ({ name: m.name, value: m.value }));
        if (stats.length > 0) out.modifiers = stats;
    }
    return out;
}

/**
 *  Build the "used in" list: names of recipes this item is an ingredient of.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Array|undefined} Recipe item names, or undefined.
 */
function buildUsedIn(item, payload) {
    const recipes = resolveField(item.usedInCraftingRecipes, payload);
    if (!Array.isArray(recipes) || recipes.length === 0) return undefined;
    const names = [];
    for (const recipe of recipes) {
        const name = linkName(recipe && recipe.itemLink);
        if (name && !names.includes(name)) names.push(name);
    }
    return names.length > 0 ? names.slice(0, MAX_USED_IN) : undefined;
}

/**
 *  Build the full extras entry for an item.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|null} The extras entry, or null when the item yields nothing.
 */
function buildExtrasEntry(item, payload) {
    const extras = {};

    if (typeof item.maxCondition === 'number' && item.maxCondition > 0) {
        extras.maxCondition = item.maxCondition;
    }

    Object.assign(extras, buildDeployable(item, payload));

    const repair = buildRepair(item, payload);
    if (repair) extras.repair = repair;

    const consumable = buildConsumable(item);
    if (consumable) extras.consumable = consumable;

    const whereToFind = buildWhereToFind(item, payload);
    if (whereToFind) extras.whereToFind = whereToFind;

    const obtainedFrom = resolveField(item.obtainedFrom, payload);
    if (Array.isArray(obtainedFrom)) {
        const sources = obtainedFrom.map(o => linkName(o && o.entityLink)).filter(Boolean);
        if (sources.length > 0) extras.obtainedFrom = sources;
    }

    const shopping = buildShopping(item, payload);
    if (shopping) extras.shopping = shopping;

    const storage = resolveField(item.storageInfo, payload);
    if (storage && typeof storage.slotsAmount === 'number' && storage.slotsAmount > 0) {
        extras.storage = {
            slots: storage.slotsAmount,
            supportsStorageMonitor: storage.supportsStorageMonitor === true ? true : undefined
        };
    }

    if (item.itemContainer && typeof item.itemContainer.maxCapacityAmount === 'number') {
        extras.container = {
            holds: item.itemContainer.contentTypeItemId || 'unknown',
            capacity: item.itemContainer.maxCapacityAmount
        };
    }

    if (item.backpack && typeof item.backpack.slots === 'number') {
        extras.backpackSlots = item.backpack.slots;
    }

    const attachment = buildAttachment(item, payload);
    if (attachment) extras.attachment = attachment;

    const usedIn = buildUsedIn(item, payload);
    if (usedIn) extras.usedIn = usedIn;

    return Object.keys(extras).length > 0 ? extras : null;
}

/**
 *  Extract mixing recipes (present only on the Mixing Table / Cooking Workbench pages)
 *  keyed by the PRODUCED item's numeric id.
 *  @param {Object} item The rusthelp item object (the table itself).
 *  @param {string} payload The decoded RSC payload.
 *  @param {Object} resolver The IdResolver (produced items resolve to numeric ids).
 *  @param {string} tableName Display name of the mixing station.
 *  @return {Object} Map of producedNumericId -> { table, yields, ingredients }.
 */
function buildMixingContributions(item, payload, resolver, tableName) {
    const recipes = resolveField(item.mixingTableRecipes, payload);
    const out = {};
    if (!Array.isArray(recipes)) return out;
    for (const recipe of recipes) {
        if (!recipe || !recipe.produces) continue;
        const producedId = resolver.resolve(recipe.produces);
        const ingredients = mapCosts(recipe.ingredients);
        if (!producedId || !ingredients) continue;
        out[producedId] = {
            table: tableName,
            yields: typeof recipe.produces.amount === 'number' ? recipe.produces.amount : 1,
            ingredients
        };
    }
    return out;
}

module.exports = { buildExtrasEntry, buildMixingContributions, resolveField, mapCosts, linkName };
