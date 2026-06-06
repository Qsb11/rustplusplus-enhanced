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
    if (Array.isArray(durabilityRecords) && durabilityRecords.length > 0) {
        const sorted = durabilityRecords.slice()
            .sort((a, b) => (a.sulfur ?? Infinity) - (b.sulfur ?? Infinity));
        data.destroyOptions = sorted.slice(0, 10).map(record => ({
            tool: nameOf(record.toolId),
            variant: record.caption || undefined,
            quantity: record.quantity,
            time: record.timeString,
            sulfurCost: record.sulfur ?? undefined,
            side: record.which || undefined
        }));
    }

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

        if (!Fs.existsSync(AI_ITEMS_DIR)) {
            Fs.mkdirSync(AI_ITEMS_DIR, { recursive: true });
        }

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

        log('info', `AI items export: ${written} files written to AI/items/${errors > 0 ? `, ${errors} errors` : ''}`);
        return { written, errors };
    }
};
