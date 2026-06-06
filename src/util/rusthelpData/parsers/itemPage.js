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

/* Map a rusthelp recycler id to the bot recycle data key. */
const RECYCLER_KEY_MAP = {
    'recycler-radtown': 'recycler',
    'recycler-safezone': 'safe-zone-recycler',
    'shredder': 'shredder'
};

/* Bot recycle efficiency constants, keyed by recycler bucket. */
const RECYCLER_EFFICIENCY = {
    'recycler': '0.6',
    'safe-zone-recycler': '0.4',
    'shredder': null
};

/**
 *  Parse a rendered item page row value by its label using the visible HTML as a fallback
 *  for pages that do not embed the rich RSC item object.
 *  @param {Object} $ A cheerio instance loaded with the page HTML.
 *  @param {string} label The label text (e.g. "Short name", "ID", "Stack size", "Despawn").
 *  @return {string|null} The trimmed value text, or null.
 */
function readLabeledValue($, label) {
    let value = null;
    $('h4').each((i, el) => {
        if (value !== null) return;
        const h = $(el).text().trim();
        if (h.toLowerCase() === label.toLowerCase()) {
            const p = $(el).parent().find('p').first();
            if (p && p.length) value = p.text().trim();
        }
    });
    return value;
}

/**
 *  Recursively walk a value collecting every {id, displayName} itemLink so the IdResolver
 *  can be primed with rusthelp-string-id -> ingameId mappings during a scrape.
 *  @param {*} node Any RSC value.
 *  @param {function} register Callback (rusthelpId, displayName) for each link found.
 *  @return {void}
 */
function collectItemLinks(node, register) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const v of node) collectItemLinks(v, register);
        return;
    }
    if (typeof node.id === 'string' && typeof node.displayName === 'string' && typeof node.url === 'string') {
        register(node.id, node.displayName);
    }
    for (const v of Object.values(node)) collectItemLinks(v, register);
}

/**
 *  Build the items.json entry for an item object.
 *  @param {Object} item The rusthelp item object.
 *  @param {string} numericId The bot numeric id (string).
 *  @param {Object} existingEntry The existing items.json entry for this id, if any.
 *  @return {Object} { shortname, name, description }.
 */
function buildItemEntry(item, numericId, existingEntry) {
    const name = (item.translated && item.translated.displayName) || item.displayName ||
        (existingEntry && existingEntry.name) || item.id;
    const description = (item.translated && item.translated.description) ||
        item.description || (existingEntry && existingEntry.description) || '';
    return {
        shortname: item.shortName || (existingEntry && existingEntry.shortname) || '',
        name,
        description
    };
}

/**
 *  Build the craft data entry from craftInfo.
 *  @param {Object} item The rusthelp item object.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} The craft entry, or null if not craftable.
 */
function buildCraftEntry(item, resolver) {
    const ci = item.craftInfo;
    if (!ci || !Array.isArray(ci.cost) || ci.cost.length === 0) return null;

    const ingredients = [];
    for (const cost of ci.cost) {
        const id = resolver.resolve(cost);
        if (!id) return null; /* Cannot faithfully represent an unresolved ingredient. */
        ingredients.push({ id, quantity: cost.amount });
    }

    let workbench = null;
    if (typeof ci.minimumWorkbenchLevelRequired === 'number' && ci.minimumWorkbenchLevelRequired > 0) {
        workbench = resolver.resolveWorkbenchLevel(ci.minimumWorkbenchLevelRequired);
    }

    let time = 0;
    if (Array.isArray(ci.craftTimePerWorkbench) && ci.craftTimePerWorkbench.length > 0) {
        time = ci.craftTimePerWorkbench[0].craftTime || 0;
    }

    return {
        ingredients,
        workbench,
        time,
        timeString: TimeFormat.formatCraftTime(time)
    };
}

/**
 *  Build the research data entry from craftInfo.
 *  @param {Object} item The rusthelp item object.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} The research entry, or null if not researchable.
 */
function buildResearchEntry(item, resolver) {
    const ci = item.craftInfo;
    if (!ci) return null;
    const rt = ci.researchTable;
    const tt = ci.techTree;
    if (!rt && !tt) return null;

    const researchTable = rt && typeof rt.scrapCost === 'number' ? rt.scrapCost : 0;

    let workbench = null;
    if (tt && tt.location) {
        const type = resolver.resolve(tt.location);
        if (type) {
            workbench = {
                type,
                scrap: typeof tt.scrapCost === 'number' ? tt.scrapCost : 0,
                totalScrap: typeof tt.totalScrapCost === 'number' ? tt.totalScrapCost : 0
            };
        }
    }

    return { researchTable, workbench };
}

/**
 *  Build one recycler bucket entry from a rusthelp recycleInfo entry.
 *  @param {Object} info A single recycleInfo element.
 *  @param {string} bucket The bot bucket key ("recycler" | "safe-zone-recycler" | "shredder").
 *  @param {Object} resolver The IdResolver.
 *  @return {Object} { efficiency, yield }.
 */
function buildRecyclerBucket(info, bucket, resolver) {
    const yieldArr = [];
    for (const out of (info.guaranteedOutput || [])) {
        const id = resolver.resolve(out);
        if (!id) continue;
        yieldArr.push({ id, probability: 1, quantity: out.amount });
    }
    for (const out of (info.percentageBasedOutput || [])) {
        const id = resolver.resolve(out);
        if (!id) continue;
        /* rusthelp expresses these as percentages (e.g. 60 -> 0.6) with a single unit yield. */
        const probability = Math.round((out.amount / 100) * 100) / 100;
        yieldArr.push({ id, probability, quantity: 1 });
    }
    return { efficiency: RECYCLER_EFFICIENCY[bucket], yield: yieldArr };
}

/**
 *  Build the recycle data entry from recycleInfo / shreddingYield.
 *  @param {Object} item The rusthelp item object.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} The recycle entry, or null if not recyclable.
 */
function buildRecycleEntry(item, resolver) {
    const hasRecycle = Array.isArray(item.recycleInfo) && item.recycleInfo.length > 0;
    const hasShred = item.canBeShredded && Array.isArray(item.shreddingYield) && item.shreddingYield.length > 0;
    if (!hasRecycle && !hasShred) return null;

    const entry = {
        'recycler': { efficiency: null, yield: [] },
        'shredder': { efficiency: null, yield: [] },
        'safe-zone-recycler': { efficiency: null, yield: [] }
    };

    if (hasRecycle) {
        for (const info of item.recycleInfo) {
            const bucket = RECYCLER_KEY_MAP[info.recyclerId];
            if (!bucket) continue;
            entry[bucket] = buildRecyclerBucket(info, bucket, resolver);
        }
    }

    if (hasShred) {
        const shredYield = [];
        for (const out of item.shreddingYield) {
            const id = resolver.resolve(out);
            if (!id) continue;
            shredYield.push({ id, probability: 1, quantity: out.amount });
        }
        entry['shredder'] = { efficiency: RECYCLER_EFFICIENCY['shredder'], yield: shredYield };
    }

    return entry;
}

/**
 *  Parse an item page and produce all item-keyed contributions.
 *  @param {string} html The raw page HTML.
 *  @param {Object} resolver The IdResolver (already primed for cross-references).
 *  @param {Object} [existingItems] Existing items.json for description/name fallbacks.
 *  @return {Object|null} { id, items, craft, research, recycle, stack, despawn } or null.
 */
function parseItemPage(html, resolver, existingItems = {}) {
    const payload = Rsc.decodeRscPayload(html);
    const item = payload ? Rsc.extractItemObject(payload) : null;

    /* Fallback: pages without the rich object still render shortname/id/stack/despawn rows. */
    if (!item) {
        return parseItemPageFromHtml(html, existingItems);
    }

    const numericId = item.ingameId !== undefined && item.ingameId !== null ? String(item.ingameId) : null;
    if (!numericId) return null;

    const result = { id: numericId };

    result.items = buildItemEntry(item, numericId, existingItems[numericId]);

    const craft = buildCraftEntry(item, resolver);
    if (craft) result.craft = craft;

    const research = buildResearchEntry(item, resolver);
    if (research) result.research = research;

    const recycle = buildRecycleEntry(item, resolver);
    if (recycle) result.recycle = recycle;

    if (typeof item.stackSize === 'number' && item.stackSize > 0) {
        result.stack = { quantity: String(item.stackSize) };
    }

    if (typeof item.despawnTimeSeconds === 'number' && item.despawnTimeSeconds > 0) {
        result.despawn = {
            time: item.despawnTimeSeconds,
            timeString: TimeFormat.formatDespawnTime(item.despawnTimeSeconds)
        };
    }

    return result;
}

/**
 *  Fallback parser for item pages without an embedded rich object (e.g. base resources).
 *  Reads the visible labeled rows; only produces items/stack/despawn contributions.
 *  @param {string} html The raw page HTML.
 *  @param {Object} existingItems Existing items.json for fallbacks.
 *  @return {Object|null} A partial contribution, or null if the id cannot be read.
 */
function parseItemPageFromHtml(html, existingItems) {
    const $ = Cheerio.load(html);
    const idText = readLabeledValue($, 'ID');
    const shortname = readLabeledValue($, 'Short name');
    const name = ($('h1').first().text() || '').trim();
    if (!idText || !/^-?\d+$/.test(idText.replace(/[, ]/g, ''))) return null;
    const numericId = idText.replace(/[, ]/g, '');

    const result = { id: numericId };
    const existing = existingItems[numericId] || {};
    result.items = {
        shortname: shortname || existing.shortname || '',
        name: name || existing.name || numericId,
        description: existing.description || ''
    };

    const stackText = readLabeledValue($, 'Stack size');
    if (stackText) {
        const q = stackText.replace(/[×x,\s]/g, '');
        if (/^\d+$/.test(q)) result.stack = { quantity: q };
    }

    return result;
}

module.exports = {
    parseItemPage,
    collectItemLinks,
    buildItemEntry,
    buildCraftEntry,
    buildResearchEntry,
    buildRecycleEntry,
    readLabeledValue
};
