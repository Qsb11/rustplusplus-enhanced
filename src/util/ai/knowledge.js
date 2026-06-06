/*
    Knowledge retrieval for the AI assistant.

    Two sources, both injected into the prompt as compact text:
    1. Game data from src/staticFiles (craft, research, recycle, raid/durability)
       for items and building blocks mentioned in the question.
    2. Curated documents from the AI/ folder in the repo root
       (markdown/text/json — electricity guides, general game knowledge, ...).
*/

const Fs = require('fs');
const Path = require('path');

const KNOWLEDGE_DIR = Path.join(__dirname, '..', '..', '..', 'AI');
const MAX_DOC_CHARS = 2500;
const MAX_DOCS = 3;
const MAX_TARGETS = 4;
const MIN_NAME_LENGTH = 4;

module.exports = {
    /**
     * Build the full context block for a question.
     * @param {Object} client - Discord client (items + rustlabs access)
     * @param {string} question - The user's question
     * @returns {string} Context text ('' when nothing relevant found)
     */
    buildContext: function (client, question) {
        const sections = [];

        const gameData = module.exports.buildGameDataContext(client, question);
        if (gameData !== '') sections.push(gameData);

        const docs = module.exports.loadRelevantDocuments(question);
        if (docs !== '') sections.push(docs);

        return sections.join('\n\n');
    },

    /**
     * Find item/building-block/entity names mentioned in the question and
     * render their game data compactly.
     */
    buildGameDataContext: function (client, question) {
        const questionLower = question.toLowerCase();
        const targets = [];

        /* Building blocks and other entities (names like 'Stone Wall'). */
        for (const name of [...client.rustlabs.buildingBlocks, ...client.rustlabs.other]) {
            if (name.length >= MIN_NAME_LENGTH && questionLower.includes(name.toLowerCase())) {
                targets.push({ type: 'name', name: name });
            }
        }

        /* Items. */
        for (const [id, data] of Object.entries(client.items.items)) {
            if (data.name.length >= MIN_NAME_LENGTH && questionLower.includes(data.name.toLowerCase())) {
                targets.push({ type: 'item', name: data.name, id: id });
            }
        }

        /* Prefer longest names (most specific match), drop duplicates/substrings. */
        targets.sort((a, b) => b.name.length - a.name.length);
        const selected = [];
        for (const target of targets) {
            if (selected.length >= MAX_TARGETS) break;
            if (selected.some(s => s.name.toLowerCase().includes(target.name.toLowerCase()))) continue;
            selected.push(target);
        }

        const parts = [];
        for (const target of selected) {
            const rendered = (target.type === 'item')
                ? renderItemData(client, target.id, target.name)
                : renderNamedTargetData(client, target.name);
            if (rendered !== '') parts.push(rendered);
        }

        return parts.length === 0 ? '' : `GAME DATA:\n${parts.join('\n')}`;
    },

    /**
     * Load the most relevant documents from the AI/ knowledge folder.
     */
    loadRelevantDocuments: function (question) {
        if (!Fs.existsSync(KNOWLEDGE_DIR)) return '';

        const files = collectFiles(KNOWLEDGE_DIR);
        if (files.length === 0) return '';

        const keywords = question.toLowerCase().split(/\W+/).filter(word => word.length >= 3);
        if (keywords.length === 0) return '';

        const scored = [];
        for (const file of files) {
            let content;
            try {
                content = Fs.readFileSync(file, 'utf8');
            }
            catch (error) {
                continue;
            }

            const haystack = `${Path.basename(file)} ${content}`.toLowerCase();
            const score = keywords.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
            if (score > 0) scored.push({ file, content, score });
        }

        scored.sort((a, b) => b.score - a.score);

        const parts = scored.slice(0, MAX_DOCS).map(doc =>
            `--- ${Path.relative(KNOWLEDGE_DIR, doc.file)} ---\n${doc.content.slice(0, MAX_DOC_CHARS)}`);

        return parts.length === 0 ? '' : `KNOWLEDGE BASE:\n${parts.join('\n')}`;
    }
};

function collectFiles(dir) {
    const result = [];
    for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = Path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...collectFiles(fullPath));
        }
        else if (/\.(md|txt|json)$/i.test(entry.name)) {
            result.push(fullPath);
        }
    }
    return result;
}

function renderItemData(client, itemId, name) {
    const lines = [`## ${name}`];

    const craft = client.rustlabs.getCraftDetailsById(itemId);
    if (craft !== null) {
        const details = craft[2];
        const ingredients = details.ingredients
            .map(ing => `${client.items.getName(ing.id)} x${ing.quantity}`).join(', ');
        const workbench = details.workbench !== null
            ? `, workbench: ${client.items.getName(details.workbench)}` : '';
        const output = (typeof details.output === 'number' && details.output > 1)
            ? ` — produces x${details.output} per craft` : '';
        lines.push(`Craft: ${ingredients} (${details.timeString}${workbench})${output}`);
    }

    const research = client.rustlabs.getResearchDetailsById(itemId);
    if (research !== null) {
        const details = research[2];
        let researchLine = `Research: ${details.researchTable} scrap (research table)`;
        if (details.workbench) {
            researchLine += `, tech tree total: ${details.workbench.totalScrap} scrap`;
        }
        lines.push(researchLine);
    }

    const recycle = client.rustlabs.getRecycleDetailsById(itemId);
    if (recycle !== null && recycle[2]['recycler']) {
        const yieldItems = recycle[2]['recycler']['yield']
            .map(y => `${client.items.getName(y.id)} x${y.quantity}${y.probability < 1 ? ` (${Math.round(y.probability * 100)}%)` : ''}`)
            .join(', ');
        if (yieldItems !== '') lines.push(`Recycle: ${yieldItems}`);
    }

    const durability = client.rustlabs.getDurabilityDetailsById(itemId);
    const raidLines = renderRaidData(client, durability);
    if (raidLines !== '') lines.push(raidLines);

    return lines.length > 1 ? lines.join('\n') : '';
}

function renderNamedTargetData(client, name) {
    const lines = [`## ${name}`];

    const decay = client.rustlabs.getDecayDetailsByName(name);
    if (decay !== null) {
        const details = decay[3];
        lines.push(`HP: ${details.hpString}${details.decayString ? `, decay: ${details.decayString}` : ''}`);
    }

    const durability = client.rustlabs.getDurabilityDetailsByName(name);
    const raidLines = renderRaidData(client, durability);
    if (raidLines !== '') lines.push(raidLines);

    return lines.length > 1 ? lines.join('\n') : '';
}

function renderRaidData(client, durability) {
    if (durability === null) return '';

    const records = durability[durability.length - 1];
    if (!Array.isArray(records) || records.length === 0) return '';

    /* Cheapest-by-sulfur first; entries without sulfur cost (melee/tools) last. */
    const sorted = records.slice().sort((a, b) => (a.sulfur ?? Infinity) - (b.sulfur ?? Infinity));

    const lines = sorted.slice(0, 8).map(record => {
        const tool = client.items.getName(record.toolId) ?? record.toolId;
        const caption = record.caption ? ` (${record.caption})` : '';
        const sulfur = record.sulfur != null ? `, sulfur: ${record.sulfur}` : '';
        const fuel = record.fuel != null ? `, fuel: ${record.fuel}` : '';
        const side = record.which ? `, side: ${record.which}` : '';
        return `- ${tool}${caption} x${record.quantity} (${record.timeString}${sulfur}${fuel}${side})`;
    });

    return `Destroy options (cheapest sulfur first):\n${lines.join('\n')}`;
}
