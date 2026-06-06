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
    Orchestrator for the free rusthelp.com item-data scraper. Replaces the previous
    Firecrawl-based scraper. Fetches the sitemap, scrapes item/building/world pages, and
    merges the results into the bot's static data files (matching the existing byte formats
    consumed by RustLabs.js / Items.js).

    Usage (headless):  node src/util/rusthelpData/run.js [--test] [--limit=N] [--dry-run] [--no-cache]
*/

const Fs = require('fs');
const Path = require('path');

const { Fetcher } = require('./fetcher.js');
const Writers = require('./writers.js');
const { IdResolver } = require('./parsers/idResolver.js');
const ItemPage = require('./parsers/itemPage.js');
const BuildingPage = require('./parsers/buildingPage.js');
const WorldPage = require('./parsers/worldPage.js');

const LOG_FILE = Path.join(__dirname, 'scraper.log');

/* A small curated set used by --test mode; covers the validation-critical items + a building. */
const TEST_SLUGS = {
    items: [
        'assault-rifle', 'rocket', 'timed-explosive-charge', 'metal-fragments', 'sheet-metal-door',
        'high-quality-metal', 'wood', 'rifle-body', 'metal-spring', 'gun-powder', 'explosives',
        'sulfur', 'charcoal', 'cloth', 'tech-trash', 'scrap', 'metal-pipe', 'low-grade-fuel',
        'sheet-metal', 'stone', 'metal-ore', 'sulfur-ore', 'satchel-charge', 'beancan-grenade',
        'wooden-door'
    ],
    building: ['stone-wall'],
    world: []
};

/**
 *  Create a logger that writes to scraper.log and forwards to a progress callback.
 *  @param {function} [progress] Optional (level, message) callback.
 *  @return {function} A log function (level, message).
 */
function createLogger(progress) {
    let stream = null;
    try {
        stream = Fs.createWriteStream(LOG_FILE, { flags: 'a' });
    } catch (error) {
        stream = null;
    }
    return (level, message) => {
        const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${message}`;
        if (stream) {
            try { stream.write(line + '\n'); } catch (error) { /* ignore */ }
        }
        if (typeof progress === 'function') {
            try { progress(level, message); } catch (error) { /* ignore */ }
        }
    };
}

/**
 *  Categorize sitemap URLs into items / building / world buckets.
 *  @param {string[]} urls The sitemap URLs.
 *  @return {{ items: string[], building: string[], world: string[] }}
 */
function categorizeUrls(urls) {
    const buckets = { items: [], building: [], world: [] };
    for (const url of urls) {
        if (/\/items\//.test(url)) buckets.items.push(url);
        else if (/\/building\//.test(url)) buckets.building.push(url);
        else if (/\/world\//.test(url)) buckets.world.push(url);
    }
    return buckets;
}

/**
 *  Run the full (or test-limited) data update.
 *  @param {Object|null} [client] Optional Discord client (calls client.reloadItemData() on success).
 *  @param {Object} [options] Options.
 *  @param {boolean} [options.test=false] Use the curated TEST_SLUGS set instead of the sitemap.
 *  @param {number|null} [options.limit=null] Cap the number of item pages scraped.
 *  @param {boolean} [options.dryRun=false] Compute merges but do not write files.
 *  @param {boolean} [options.useCache=true] Use the on-disk HTML cache.
 *  @param {function} [options.progress] Progress callback (level, message).
 *  @return {Promise<Object>} A result summary.
 */
async function runFullUpdate(client = null, options = {}) {
    const log = createLogger(options.progress);
    const test = options.test === true;
    const limit = typeof options.limit === 'number' ? options.limit : null;
    const dryRun = options.dryRun === true;
    const fetcher = new Fetcher({ useCache: options.useCache !== false, log });

    log('info', `Starting rusthelp data update (test=${test}, limit=${limit}, dryRun=${dryRun})`);

    const existingItems = Writers.readStatic('items.json', {});
    const resolver = new IdResolver(existingItems);

    /* Determine which pages to scrape. */
    let itemUrls = [];
    let buildingUrls = [];
    let worldUrls = [];

    if (Array.isArray(options.itemSlugs) && options.itemSlugs.length > 0) {
        /* Explicit single/few item update (e.g. /updatedatabase ITEM). */
        itemUrls = options.itemSlugs.map(s => (s.startsWith('/') ? s : `/items/${s}`));
    } else if (test) {
        itemUrls = TEST_SLUGS.items.map(s => `/items/${s}`);
        buildingUrls = TEST_SLUGS.building.map(s => `/building/${s}`);
        worldUrls = TEST_SLUGS.world.map(s => `/world/${s}`);
    } else {
        const sitemap = await fetcher.fetchSitemap();
        const buckets = categorizeUrls(sitemap);
        itemUrls = buckets.items;
        buildingUrls = buckets.building;
        worldUrls = buckets.world;
        log('info', `Sitemap: ${itemUrls.length} items, ${buildingUrls.length} buildings, ${worldUrls.length} world`);
    }

    if (limit !== null) itemUrls = itemUrls.slice(0, limit);

    const out = {
        items: {}, craft: {}, research: {}, recycle: {}, stack: {}, despawn: {}
    };
    const buildingContrib = { name2slug: {}, hpByName: {}, durabilityByName: {} };
    const worldContrib = { name2slug: {}, durabilityByName: {} };

    let itemErrors = 0;
    let itemOk = 0;

    /* ---- Item pages ---- */
    for (let i = 0; i < itemUrls.length; i++) {
        const url = itemUrls[i];
        const html = await fetcher.fetchPage(url);
        if (!html) { itemErrors++; continue; }
        try {
            const parsed = ItemPage.parseItemPage(html, resolver, existingItems);
            if (!parsed || !parsed.id) { itemErrors++; continue; }

            /* Prime resolver from this page so later cross-references resolve by rusthelp id too. */
            const payloadItem = parsed.items;
            if (payloadItem && payloadItem.shortname) {
                resolver.register(url.replace(/^.*\/items\//, '').replace(/\/$/, ''), parsed.id);
            }

            out.items[parsed.id] = parsed.items;
            if (parsed.craft) out.craft[parsed.id] = parsed.craft;
            if (parsed.research) out.research[parsed.id] = parsed.research;
            if (parsed.recycle) out.recycle[parsed.id] = parsed.recycle;
            if (parsed.stack) out.stack[parsed.id] = parsed.stack;
            if (parsed.despawn) out.despawn[parsed.id] = parsed.despawn;
            itemOk++;
        } catch (error) {
            itemErrors++;
            log('warning', `Failed to parse ${url}: ${error.message}`);
        }
        if ((i + 1) % 50 === 0) log('info', `Items progress: ${i + 1}/${itemUrls.length}`);
    }

    /* ---- Building pages ---- */
    let buildingOk = 0;
    for (const url of buildingUrls) {
        const html = await fetcher.fetchPage(url);
        if (!html) continue;
        try {
            const parsed = BuildingPage.parseBuildingPage(html, url, resolver);
            if (!parsed) continue;
            buildingContrib.name2slug[parsed.name] = parsed.slug;
            if (parsed.hp !== null) buildingContrib.hpByName[parsed.name] = parsed.hp;
            if (parsed.durability && parsed.durability.length > 0) {
                buildingContrib.durabilityByName[parsed.name] = parsed.durability;
            }
            buildingOk++;
        } catch (error) {
            log('warning', `Failed to parse building ${url}: ${error.message}`);
        }
    }

    /* ---- World pages ---- */
    let worldOk = 0;
    for (const url of worldUrls) {
        const html = await fetcher.fetchPage(url);
        if (!html) continue;
        try {
            const parsed = WorldPage.parseWorldPage(html, url, resolver);
            if (!parsed) continue;
            worldContrib.name2slug[parsed.name] = parsed.slug;
            if (parsed.durability && parsed.durability.length > 0) {
                worldContrib.durabilityByName[parsed.name] = parsed.durability;
            }
            worldOk++;
        } catch (error) {
            log('warning', `Failed to parse world ${url}: ${error.message}`);
        }
    }

    /* ---- Merge & write item-keyed files ---- */
    const results = {};
    const shapeIssues = [];
    const mergeOpts = { dryRun, log };

    results.items = Writers.mergeKeyedFile('items.json', out.items, mergeOpts);
    results.craft = Writers.mergeKeyedFile('rustlabsCraftData.json', out.craft, mergeOpts);
    results.research = Writers.mergeKeyedFile('rustlabsResearchData.json', out.research, mergeOpts);
    results.recycle = Writers.mergeKeyedFile('rustlabsRecycleData.json', out.recycle, mergeOpts);
    results.stack = Writers.mergeKeyedFile('rustlabsStackData.json', out.stack, mergeOpts);
    results.despawn = Writers.mergeKeyedFile('rustlabsDespawnData.json', out.despawn, mergeOpts);
    for (const r of Object.values(results)) shapeIssues.push(...(r.shapeIssues || []));

    /* ---- buildingBlocks.json / other.json slug maps ---- */
    if (Object.keys(buildingContrib.name2slug).length > 0) {
        const bb = Writers.readStatic('rustlabsBuildingBlocks.json', {});
        const mergedBb = { ...bb, ...buildingContrib.name2slug };
        if (!dryRun) Writers.writeStaticAtomic('rustlabsBuildingBlocks.json', mergedBb);
    }
    if (Object.keys(worldContrib.name2slug).length > 0) {
        const other = Writers.readStatic('rustlabsOther.json', {});
        const mergedOther = { ...other, ...worldContrib.name2slug };
        if (!dryRun) Writers.writeStaticAtomic('rustlabsOther.json', mergedOther);
    }

    /* ---- Decay HP update (merge-preserve: only refresh hp/hpString for known building blocks) ---- */
    if (Object.keys(buildingContrib.hpByName).length > 0) {
        const decay = Writers.readStatic('rustlabsDecayData.json', { items: {}, buildingBlocks: {}, other: {} });
        for (const [name, hp] of Object.entries(buildingContrib.hpByName)) {
            const existing = decay.buildingBlocks[name];
            if (existing) {
                decay.buildingBlocks[name] = { ...existing, hp, hpString: String(hp) };
            }
        }
        if (!dryRun) Writers.writeStaticAtomic('rustlabsDecayData.json', decay);
    }

    if (client && typeof client.reloadItemData === 'function' && !dryRun) {
        try { client.reloadItemData(); } catch (error) { log('warning', `reloadItemData failed: ${error.message}`); }
    }

    /* ---- AI knowledge export: one JSON per item into AI/items/ ---- */
    if (!dryRun) {
        try {
            const AiExport = require('./aiExport.js');
            AiExport.exportAiItems({ log });
        }
        catch (error) {
            log('warning', `AI items export failed: ${error.message}`);
        }
    }

    const summary = {
        success: itemOk > 0 || buildingOk > 0,
        itemsScraped: itemOk,
        itemErrors,
        buildingsScraped: buildingOk,
        worldScraped: worldOk,
        totalItems: results.items ? Object.keys(results.items.merged).length : 0,
        newItems: results.items ? results.items.added : 0,
        updatedItems: results.items ? results.items.updated : 0,
        shapeIssues,
        dryRun
    };
    log('info', `Update complete: ${JSON.stringify(summary)}`);
    return summary;
}

module.exports = { runFullUpdate, categorizeUrls, TEST_SLUGS };
