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
const MonumentPage = require('./parsers/monumentPage.js');

const LOG_FILE = Path.join(__dirname, 'scraper.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024; /* Rotate scraper.log past this size. */

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
    world: [],
    monuments: ['launch-site']
};

/**
 *  Create a logger that writes to scraper.log and forwards to a progress callback.
 *  @param {function} [progress] Optional (level, message) callback.
 *  @return {function} A log function (level, message).
 */
function createLogger(progress) {
    let stream = null;
    try {
        /* Size-based rotation: keep one previous generation as scraper.log.old. */
        try {
            if (Fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
                Fs.rmSync(`${LOG_FILE}.old`, { force: true });
                Fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
            }
        } catch (error) { /* no log file yet */ }
        stream = Fs.createWriteStream(LOG_FILE, { flags: 'a' });
    } catch (error) {
        stream = null;
    }
    const log = (level, message) => {
        const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${message}`;
        if (stream) {
            try { stream.write(line + '\n'); } catch (error) { /* ignore */ }
        }
        if (typeof progress === 'function') {
            try { progress(level, message); } catch (error) { /* ignore */ }
        }
    };
    log.close = () => {
        if (stream) {
            try { stream.end(); } catch (error) { /* ignore */ }
            stream = null;
        }
    };
    return log;
}

/**
 *  Categorize sitemap URLs into items / building / world buckets.
 *  @param {string[]} urls The sitemap URLs.
 *  @return {{ items: string[], building: string[], world: string[] }}
 */
function categorizeUrls(urls) {
    const buckets = { items: [], building: [], world: [], monuments: [] };
    for (const url of urls) {
        /* /browse/... category listing pages are not entity pages — they only inflate
           parse-error counts when fed through the entity parsers. */
        if (/\/browse\//.test(url)) continue;
        if (/\/items\//.test(url)) buckets.items.push(url);
        else if (/\/building\//.test(url)) buckets.building.push(url);
        else if (/\/world\//.test(url)) buckets.world.push(url);
        else if (/\/monument\//.test(url)) buckets.monuments.push(url);
    }
    return buckets;
}

/**
 *  Filter durability contributions so a scrape can only replace an existing record set
 *  when the new one is comparably complete (>= half the records). A page that parsed
 *  thin (layout change, partial payload) must never wipe rich legacy data.
 *  @param {Object} contrib { items, buildingBlocks, other } keyed sections of record arrays.
 *  @param {function} log The logger.
 *  @return {Object|null} The guarded contributions, or null when nothing remains.
 */
function guardDurability(contrib, log) {
    const existing = Writers.readStatic('rustlabsDurabilityData.json',
        { items: {}, buildingBlocks: {}, other: {} });
    const guarded = { items: {}, buildingBlocks: {}, other: {} };
    let kept = 0;
    for (const section of ['items', 'buildingBlocks', 'other']) {
        for (const [key, records] of Object.entries(contrib[section] || {})) {
            if (!Array.isArray(records) || records.length === 0) continue;
            const old = existing[section] && existing[section][key];
            if (Array.isArray(old) && old.length > records.length * 2) {
                log('warning', `durability ${section}/${key}: scraped ${records.length} records ` +
                    `but legacy has ${old.length} — keeping legacy data`);
                continue;
            }
            guarded[section][key] = records;
            kept++;
        }
    }
    return kept > 0 ? guarded : null;
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
    try {
        return await runFullUpdateInner(client, options, log);
    } finally {
        log.close();
    }
}

/**
 *  The actual update implementation; see runFullUpdate for the public contract.
 *  @param {Object|null} client Optional Discord client.
 *  @param {Object} options Options (see runFullUpdate).
 *  @param {function} log Logger from createLogger.
 *  @return {Promise<Object>} A result summary.
 */
async function runFullUpdateInner(client, options, log) {
    const test = options.test === true;
    const limit = typeof options.limit === 'number' ? options.limit : null;
    const dryRun = options.dryRun === true;
    const fetcher = new Fetcher({
        useCache: options.useCache !== false,
        cacheMaxAgeMs: typeof options.cacheMaxAgeMs === 'number' ? options.cacheMaxAgeMs : null,
        log
    });

    log('info', `Starting rusthelp data update (test=${test}, limit=${limit}, dryRun=${dryRun})`);

    const existingItems = Writers.readStatic('items.json', {});
    const resolver = new IdResolver(existingItems);

    /* Determine which pages to scrape. */
    let itemUrls = [];
    let buildingUrls = [];
    let worldUrls = [];
    let monumentUrls = [];

    if (Array.isArray(options.itemSlugs) && options.itemSlugs.length > 0) {
        /* Explicit single/few item update (e.g. /updatedatabase ITEM). */
        itemUrls = options.itemSlugs.map(s => (s.startsWith('/') ? s : `/items/${s}`));
    } else if (test) {
        itemUrls = TEST_SLUGS.items.map(s => `/items/${s}`);
        buildingUrls = TEST_SLUGS.building.map(s => `/building/${s}`);
        worldUrls = TEST_SLUGS.world.map(s => `/world/${s}`);
        monumentUrls = TEST_SLUGS.monuments.map(s => `/monument/${s}`);
    } else {
        const sitemap = await fetcher.fetchSitemap();
        const buckets = categorizeUrls(sitemap);
        itemUrls = buckets.items;
        buildingUrls = buckets.building;
        worldUrls = buckets.world;
        monumentUrls = buckets.monuments;
        log('info', `Sitemap: ${itemUrls.length} items, ${buildingUrls.length} buildings, ` +
            `${worldUrls.length} world, ${monumentUrls.length} monuments`);
    }

    if (limit !== null) itemUrls = itemUrls.slice(0, limit);

    const out = {
        items: {}, craft: {}, research: {}, recycle: {}, stack: {}, despawn: {},
        extras: {}, durabilityItems: {}
    };
    const buildingContrib = {
        name2slug: {}, hpByName: {}, durabilityByName: {}, extrasByName: {}, upkeepByName: {}
    };
    const worldContrib = { name2slug: {}, durabilityByName: {}, entitiesByName: {} };

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
            if (parsed.extras) {
                out.extras[parsed.id] = { ...(out.extras[parsed.id] || {}), ...parsed.extras };
            }
            if (parsed.durability) out.durabilityItems[parsed.id] = parsed.durability;
            if (parsed.mixing) {
                /* Mixing recipes are keyed by the PRODUCED item's id, not this page's. */
                for (const [producedId, recipe] of Object.entries(parsed.mixing)) {
                    out.extras[producedId] = { ...(out.extras[producedId] || {}), mixing: recipe };
                }
            }
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
            const blockExtras = {};
            if (parsed.hp !== null) blockExtras.hp = parsed.hp;
            if (parsed.buildCost) blockExtras.buildCost = parsed.buildCost;
            if (parsed.upkeep) blockExtras.upkeep = parsed.upkeep;
            if (parsed.repair) blockExtras.repair = parsed.repair;
            if (Object.keys(blockExtras).length > 0) {
                buildingContrib.extrasByName[parsed.name] = blockExtras;
            }
            if (parsed.upkeep) buildingContrib.upkeepByName[parsed.name] = parsed.upkeep;
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
            const entity = {};
            if (parsed.hp !== null) entity.hp = parsed.hp;
            if (parsed.loot) entity.loot = parsed.loot;
            if (parsed.harvest) entity.harvest = parsed.harvest;
            if (parsed.contains) entity.contains = parsed.contains;
            if (parsed.foundAt) entity.foundAt = parsed.foundAt;
            if (Object.keys(entity).length > 0) {
                worldContrib.entitiesByName[parsed.name] = { slug: parsed.slug, ...entity };
            }
            worldOk++;
        } catch (error) {
            log('warning', `Failed to parse world ${url}: ${error.message}`);
        }
    }

    /* ---- Monument pages (puzzle requirements, features, loot spawns) ---- */
    const monumentsByName = {};
    let monumentOk = 0;
    for (const url of monumentUrls) {
        const html = await fetcher.fetchPage(url);
        if (!html) continue;
        try {
            const parsed = MonumentPage.parseMonumentPage(html, url);
            if (!parsed) continue;
            monumentsByName[parsed.name] = parsed;
            monumentOk++;
        } catch (error) {
            log('warning', `Failed to parse monument ${url}: ${error.message}`);
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

    /* ---- Durability (raid/destroy) data ----
       Replace an existing record set only when the scrape produced a comparably complete
       one, so a thin parse can never silently downgrade rich legacy data. */
    const durabilityContrib = guardDurability({
        items: out.durabilityItems,
        buildingBlocks: buildingContrib.durabilityByName,
        other: worldContrib.durabilityByName
    }, log);
    if (durabilityContrib) {
        Writers.mergeSectionedFile('rustlabsDurabilityData.json', durabilityContrib, mergeOpts);
    }

    /* ---- Item extras (repair/loot/vending/consumable/... for the AI export) ---- */
    if (Object.keys(out.extras).length > 0 && !dryRun) {
        const existingExtras = Writers.readStatic('rusthelpExtras.json', {});
        const mergedExtras = { ...existingExtras };
        for (const [id, entry] of Object.entries(out.extras)) {
            mergedExtras[id] = { ...(existingExtras[id] || {}), ...entry };
        }
        Writers.writeStaticAtomic('rusthelpExtras.json', mergedExtras);
        log('info', `rusthelpExtras.json: ${Object.keys(out.extras).length} entries merged, ` +
            `${Object.keys(mergedExtras).length} total`);
    }

    /* ---- Building-block extras (build cost / upkeep / repair, keyed by display name) ---- */
    if (Object.keys(buildingContrib.extrasByName).length > 0 && !dryRun) {
        const existingBlocks = Writers.readStatic('rusthelpBuildingExtras.json', {});
        const mergedBlocks = { ...existingBlocks };
        for (const [name, entry] of Object.entries(buildingContrib.extrasByName)) {
            mergedBlocks[name] = { ...(existingBlocks[name] || {}), ...entry };
        }
        Writers.writeStaticAtomic('rusthelpBuildingExtras.json', mergedBlocks);
        log('info', `rusthelpBuildingExtras.json: ${Object.keys(buildingContrib.extrasByName).length} entries merged`);
    }

    /* ---- World entities (loot tables / harvesting / pickups, keyed by display name) ---- */
    if (Object.keys(worldContrib.entitiesByName).length > 0 && !dryRun) {
        const existingEntities = Writers.readStatic('rusthelpWorldEntities.json', {});
        const mergedEntities = { ...existingEntities };
        for (const [name, entry] of Object.entries(worldContrib.entitiesByName)) {
            mergedEntities[name] = { ...(existingEntities[name] || {}), ...entry };
        }
        Writers.writeStaticAtomic('rusthelpWorldEntities.json', mergedEntities);
        log('info', `rusthelpWorldEntities.json: ${Object.keys(worldContrib.entitiesByName).length} entities merged`);
    }

    /* ---- Monuments (puzzles/features/spawns, keyed by display name) ---- */
    if (Object.keys(monumentsByName).length > 0 && !dryRun) {
        const existingMonuments = Writers.readStatic('rusthelpMonuments.json', {});
        const mergedMonuments = { ...existingMonuments };
        for (const [name, entry] of Object.entries(monumentsByName)) {
            mergedMonuments[name] = { ...(existingMonuments[name] || {}), ...entry };
        }
        Writers.writeStaticAtomic('rusthelpMonuments.json', mergedMonuments);
        log('info', `rusthelpMonuments.json: ${Object.keys(monumentsByName).length} monuments merged`);
    }

    /* ---- Upkeep refresh (legacy shape: [{ id, quantity: "1" | "1–4" }]) ---- */
    const upkeepContrib = {};
    for (const [name, entries] of Object.entries(buildingContrib.upkeepByName)) {
        const legacy = [];
        for (const entry of entries) {
            const id = resolver.resolve({ displayName: entry.name });
            if (!id) continue;
            legacy.push({
                id,
                quantity: entry.min === entry.max ? String(entry.min) : `${entry.min}–${entry.max}`
            });
        }
        if (legacy.length > 0) upkeepContrib[name] = legacy;
    }
    if (Object.keys(upkeepContrib).length > 0) {
        Writers.mergeSectionedFile('rustlabsUpkeepData.json',
            { items: {}, buildingBlocks: upkeepContrib, other: {} }, mergeOpts);
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
        monumentsScraped: monumentOk,
        totalItems: results.items ? Object.keys(results.items.merged).length : 0,
        newItems: results.items ? results.items.added : 0,
        updatedItems: results.items ? results.items.updated : 0,
        extrasEntries: Object.keys(out.extras).length,
        durabilityEntries: Object.keys(out.durabilityItems).length +
            Object.keys(buildingContrib.durabilityByName).length +
            Object.keys(worldContrib.durabilityByName).length,
        shapeIssues,
        dryRun
    };
    log('info', `Update complete: ${JSON.stringify(summary)}`);
    return summary;
}

module.exports = { runFullUpdate, categorizeUrls, TEST_SLUGS };
