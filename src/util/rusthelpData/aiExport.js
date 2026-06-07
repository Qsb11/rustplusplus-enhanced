/*
    AI knowledge export — writes one JSON file per item into AI/items/ so the
    AI assistant's document retrieval can search individual item files.

    All data comes from src/staticFiles (no network). Ingredient/yield ids are
    resolved to display names so the files are self-contained and readable by
    small models without extra lookups.
*/

const Fs = require('fs');
const Path = require('path');

const STATIC_DIR = Path.join(__dirname, '..', '..', 'staticFiles');
const AI_ITEMS_DIR = Path.join(__dirname, '..', '..', '..', 'AI', 'items');

function readStatic(filename, fallback) {
    try {
        return JSON.parse(Fs.readFileSync(Path.join(STATIC_DIR, filename), 'utf8'));
    }
    catch (error) {
        return fallback;
    }
}

function safeFilename(name) {
    return name.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '_');
}

/**
 *  Build the export object for one item.
 */
function buildItemExport(id, items, craft, research, recycle, stack, despawn, durability) {
    const nameOf = (itemId) => (items[itemId] && items[itemId].name) || String(itemId);
    const entry = items[id];

    const data = {
        id: id,
        name: entry.name,
        shortname: entry.shortname,
        description: entry.description || undefined
    };

    const craftEntry = craft[id];
    if (craftEntry) {
        const output = (typeof craftEntry.output === 'number' && craftEntry.output > 0)
            ? craftEntry.output : 1;
        data.craft = {
            ingredients: craftEntry.ingredients.map(ing => ({
                name: nameOf(ing.id),
                quantity: ing.quantity
            })),
            producesPerCraft: output,
            workbench: craftEntry.workbench !== null ? nameOf(craftEntry.workbench) : null,
            craftTime: craftEntry.timeString
        };
    }

    const researchEntry = research[id];
    if (researchEntry) {
        data.research = {
            researchTableScrap: researchEntry.researchTable,
            techTreeTotalScrap: researchEntry.workbench ? researchEntry.workbench.totalScrap : null
        };
    }

    const recycleEntry = recycle[id];
    if (recycleEntry && recycleEntry.recycler && recycleEntry.recycler.yield.length > 0) {
        data.recycle = recycleEntry.recycler.yield.map(y => ({
            name: nameOf(y.id),
            quantity: y.quantity,
            chance: y.probability < 1 ? `${Math.round(y.probability * 100)}%` : undefined
        }));
    }

    const stackEntry = stack[id];
    if (stackEntry) data.stackSize = parseInt(stackEntry.quantity, 10) || stackEntry.quantity;

    const despawnEntry = despawn[id];
    if (despawnEntry) data.despawnTime = despawnEntry.timeString;

    const durabilityRecords = durability.items && durability.items[id];
    const destroy = buildDestroyOptions(durabilityRecords, nameOf);
    if (destroy) data.destroyOptions = destroy;

    return data;
}

/**
 *  Split raid/destroy records into fast-explosive (preferred) and eco options.
 *  @param {Array|undefined} records Durability records for the target.
 *  @param {function} nameOf Resolve item id -> name.
 *  @return {Object|null} { fast, eco } or null when no records.
 */
function buildDestroyOptions(records, nameOf) {
    if (!Array.isArray(records) || records.length === 0) return null;

    const bySulfur = (a, b) => (a.sulfurCost ?? Infinity) - (b.sulfurCost ?? Infinity);

    /* Real raid tools only. RustHelp lists every theoretical method (torpedoes,
       each firearm firing explosive ammo, melee soft-side, ...) which is noise.
       Keep actual explosives + a single representative for explosive ammo. */
    const rows = [];
    let bestExplosiveAmmo = null;
    for (const record of records) {
        const tool = nameOf(record.toolId);
        const row = {
            tool,
            variant: record.caption || undefined,
            quantity: record.quantity,
            time: record.timeString,
            sulfurCost: record.sulfur ?? undefined,
            side: record.which || undefined
        };

        /* Explosive 5.56 fired from any gun is one method — keep the cheapest,
           relabelled, and drop the per-weapon duplicates. */
        if (/explosive 5\.56/i.test(`${tool} ${row.variant || ''}`)) {
            const candidate = { ...row, tool: 'Explosive 5.56 Rifle Ammo', variant: undefined };
            if (!bestExplosiveAmmo || (candidate.sulfurCost ?? Infinity) < (bestExplosiveAmmo.sulfurCost ?? Infinity)) {
                bestExplosiveAmmo = candidate;
            }
            continue;
        }

        /* Keep only genuine explosive raiding tools. */
        if (/(c4|timed explosive|^rocket|high velocity rocket|satchel|beancan|f1 grenade)/i.test(tool)) {
            rows.push(row);
        }
        /* Everything else (torpedo, plain firearms, melee, MLRS, siege) is dropped. */
    }

    if (bestExplosiveAmmo) rows.push(bestExplosiveAmmo);
    if (rows.length === 0) return null;

    rows.sort(bySulfur);
    return rows.slice(0, 8);
}

/**
 *  Build an export entry for a building block / other entity (keyed by name).
 *  @param {string} name Display name (e.g. "Stone Wall").
 *  @param {Object} decaySection decayData[section] keyed by name.
 *  @param {Object} durabilitySection durabilityData[section] keyed by name.
 *  @param {function} nameOf Resolve item id -> name.
 *  @return {Object} Export object.
 */
function buildNamedExport(name, decaySection, durabilitySection, nameOf) {
    const data = { name, kind: 'buildingBlock' };

    const decay = decaySection[name];
    if (decay) {
        data.hp = decay.hp;
        if (decay.decayString) data.decay = decay.decayString;
    }

    const destroy = buildDestroyOptions(durabilitySection[name], nameOf);
    if (destroy) data.destroyOptions = destroy;

    return data;
}

module.exports = {
    /**
     *  Export every item in items.json as AI/items/<Name>.json.
     *  @param {Object} [opts] Options: { log }.
     *  @return {{ written: number, errors: number }}
     */
    exportAiItems: function (opts = {}) {
        const log = typeof opts.log === 'function' ? opts.log : (() => { });

        const items = readStatic('items.json', {});
        const craft = readStatic('rustlabsCraftData.json', {});
        const research = readStatic('rustlabsResearchData.json', {});
        const recycle = readStatic('rustlabsRecycleData.json', {});
        const stack = readStatic('rustlabsStackData.json', {});
        const despawn = readStatic('rustlabsDespawnData.json', {});
        const durability = readStatic('rustlabsDurabilityData.json', {});
        const decay = readStatic('rustlabsDecayData.json', { items: {}, buildingBlocks: {}, other: {} });

        if (!Fs.existsSync(AI_ITEMS_DIR)) {
            Fs.mkdirSync(AI_ITEMS_DIR, { recursive: true });
        }

        const nameOf = (id) => (items[id] && items[id].name) || String(id);

        let written = 0;
        let errors = 0;
        for (const id of Object.keys(items)) {
            try {
                const data = buildItemExport(id, items, craft, research, recycle, stack, despawn, durability);
                const filename = `${safeFilename(items[id].name)}.json`;
                Fs.writeFileSync(Path.join(AI_ITEMS_DIR, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
                written++;
            }
            catch (error) {
                errors++;
                log('warning', `AI export failed for item ${id}: ${error.message}`);
            }
        }

        /* Building blocks (Stone Wall, Sheet Metal Door, etc.) live keyed by name,
           not in items.json — export them so get_item can answer wall/door raids. */
        const blockNames = new Set([
            ...Object.keys(durability.buildingBlocks || {}),
            ...Object.keys((decay && decay.buildingBlocks) || {})
        ]);
        let blocks = 0;
        for (const name of blockNames) {
            try {
                const data = buildNamedExport(name, (decay && decay.buildingBlocks) || {},
                    durability.buildingBlocks || {}, nameOf);
                Fs.writeFileSync(Path.join(AI_ITEMS_DIR, `${safeFilename(name)}.json`),
                    JSON.stringify(data, null, 2) + '\n', 'utf8');
                blocks++;
            }
            catch (error) {
                errors++;
                log('warning', `AI export failed for building block ${name}: ${error.message}`);
            }
        }

        log('info', `AI items export: ${written} items + ${blocks} building blocks written to AI/items/${errors > 0 ? `, ${errors} errors` : ''}`);
        return { written, blocks, errors };
    }
};
