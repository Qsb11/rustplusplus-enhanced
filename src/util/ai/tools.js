/*
    AI tool definitions + executors.

    Exposes live Rust+ server data (team, server info, time, map markers /
    vending machines, smart devices) and the AI/ knowledge folder to the model
    via OpenAI-style function calling. Control tools (toggling switches) are
    gated behind config + caller permissions.

    Each executor returns a short string (or compact JSON) that is fed back to
    the model as the tool result.
*/

const Fs = require('fs');
const Path = require('path');

const Config = require('../../../config');
const Knowledge = require('./knowledge.js');
const Map = require('../map.js');

const AI_ITEMS_DIR = Path.join(__dirname, '..', '..', '..', 'AI', 'items');

/* Rust+ map marker type ids (mirror of MapMarkers.types). */
const MARKER_TYPE = {
    1: 'Player', 2: 'Explosion', 3: 'VendingMachine', 4: 'CH47',
    5: 'CargoShip', 6: 'Crate', 7: 'GenericRadius', 8: 'PatrolHelicopter', 9: 'TravelingVendor'
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getOperationalRustplus(ctx) {
    const rustplus = ctx.client.rustplusInstances[ctx.guildId];
    if (!rustplus || !rustplus.isOperational) return null;
    return rustplus;
}

function itemName(ctx, id) {
    return ctx.client.items.getName(String(id)) ?? String(id);
}

/* ------------------------------------------------------------------ */
/* Executors                                                           */
/* ------------------------------------------------------------------ */

async function execSearchKnowledge(ctx, args) {
    const query = (args.query || '').trim();
    if (query === '') return 'No query provided.';
    const docs = Knowledge.loadRelevantDocuments(query);
    return docs !== '' ? docs : 'No matching knowledge documents found.';
}

async function execGetItem(ctx, args) {
    const name = (args.name || '').trim();
    if (name === '') return 'No item name provided.';

    if (!Fs.existsSync(AI_ITEMS_DIR)) return 'Item knowledge folder not found.';

    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const wantedWords = norm(name).split(' ').filter(Boolean);
    const wantedJoined = wantedWords.join('');

    let best = null;
    let bestScore = -Infinity;
    const partials = [];
    for (const file of Fs.readdirSync(AI_ITEMS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const display = file.slice(0, -5).replace(/_/g, ' ');
        const label = norm(display);
        const labelWords = label.split(' ').filter(Boolean);
        const labelJoined = labelWords.join('');

        if (labelJoined === wantedJoined) { best = file; break; } /* exact */

        /* Word-overlap scoring: count query words present as whole words,
           then prefer the most specific (fewest extra words). */
        const matched = wantedWords.filter(w => labelWords.includes(w)).length;
        /* Substring fallback catches "ak" -> nothing-as-word but helps partials. */
        const substr = labelJoined.includes(wantedJoined) || wantedJoined.includes(labelJoined);
        if (matched === 0 && !substr) continue;

        const allWanted = matched === wantedWords.length;
        const score = matched * 100 - Math.abs(labelWords.length - wantedWords.length)
            + (allWanted ? 50 : 0) + (substr ? 5 : 0);
        partials.push({ display, score });
        if (score > bestScore) { bestScore = score; best = file; }
    }

    if (!best) {
        /* No confident match — return suggestions so the model can retry with a
           corrected name instead of giving up. */
        const suggestions = partials.sort((a, b) => b.score - a.score).slice(0, 8).map(p => p.display);
        if (suggestions.length > 0) {
            return `No exact match for "${name}". Did you mean one of: ${suggestions.join(', ')}? ` +
                `Call get_item again with the correct name.`;
        }
        return `No item found for "${name}". Try search_items to find the correct name.`;
    }
    try {
        return Fs.readFileSync(Path.join(AI_ITEMS_DIR, best), 'utf8');
    }
    catch (error) {
        return `Failed to read item data: ${error.message}`;
    }
}

async function execSearchItems(ctx, args) {
    const query = (args.query || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query === '') return 'No query provided.';
    if (!Fs.existsSync(AI_ITEMS_DIR)) return 'Item knowledge folder not found.';

    const words = query.split(' ').filter(Boolean);
    const matches = [];
    for (const file of Fs.readdirSync(AI_ITEMS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const display = file.slice(0, -5).replace(/_/g, ' ');
        const hay = display.toLowerCase();
        if (words.every(w => hay.includes(w))) matches.push(display);
    }
    if (matches.length === 0) return `No item names matching "${args.query}".`;
    return JSON.stringify(matches.slice(0, 25));
}

async function execGetServerInfo(ctx) {
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const info = await rustplus.getInfoAsync();
    if (!await rustplus.isResponseValid(info)) return 'Failed to read server info.';
    const i = info.info;
    return JSON.stringify({
        name: i.name,
        players: i.players,
        maxPlayers: i.maxPlayers,
        queued: i.queuedPlayers,
        mapSize: i.mapSize,
        wipeTime: i.wipeTime
    });
}

async function execGetTime(ctx) {
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const time = await rustplus.getTimeAsync();
    if (!await rustplus.isResponseValid(time)) return 'Failed to read time.';
    const t = time.time;
    const isDay = t.time >= t.sunrise && t.time < t.sunset;
    return JSON.stringify({
        time: t.time.toFixed(2),
        isDay,
        sunrise: t.sunrise,
        sunset: t.sunset
    });
}

async function execGetTeam(ctx) {
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const info = await rustplus.getTeamInfoAsync();
    if (!await rustplus.isResponseValid(info)) return 'Failed to read team info.';

    const mapSize = rustplus.info ? rustplus.info.correctedMapSize : null;
    const members = info.teamInfo.members.map(m => ({
        name: m.name,
        online: m.isOnline,
        alive: m.isAlive,
        leader: m.steamId.toString() === info.teamInfo.leaderSteamId.toString(),
        grid: (m.isOnline && mapSize) ? Map.getGridPos(m.x, m.y, mapSize) : null
    }));
    return JSON.stringify(members);
}

async function execGetMapMarkers(ctx, args) {
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const filter = (args.type || '').toLowerCase();
    const itemFilter = (args.item || '').toLowerCase().trim();

    const response = await rustplus.getMapMarkersAsync();
    if (!await rustplus.isResponseValid(response)) return 'Failed to read map markers.';

    const mapSize = rustplus.info ? rustplus.info.correctedMapSize : null;
    const out = [];
    for (const marker of response.mapMarkers.markers) {
        const typeName = MARKER_TYPE[marker.type] || `Type${marker.type}`;
        if (filter && !typeName.toLowerCase().includes(filter)) continue;

        const entry = { type: typeName };
        if (mapSize) entry.grid = Map.getGridPos(marker.x, marker.y, mapSize);

        if (marker.type === 3 && Array.isArray(marker.sellOrders)) {
            /* Vending machine — list in-stock sell orders. */
            let sells = marker.sellOrders
                .filter(o => o.amountInStock > 0)
                .map(o => ({
                    item: itemName(ctx, o.itemId) + (o.itemIsBlueprint ? ' (BP)' : ''),
                    qty: o.quantity,
                    cost: `${o.costPerItem} ${itemName(ctx, o.currencyId)}`,
                    stock: o.amountInStock
                }));
            /* When searching for a specific item, only keep machines that sell it. */
            if (itemFilter) {
                sells = sells.filter(s => s.item.toLowerCase().includes(itemFilter));
                if (sells.length === 0) continue;
            }
            entry.sells = sells;
        }
        else if (itemFilter) {
            /* Item search only cares about vending machines. */
            continue;
        }
        out.push(entry);
    }

    if (out.length === 0) {
        if (itemFilter) return `No vending machine currently selling "${args.item}".`;
        return filter ? `No markers of type "${filter}".` : 'No active map markers.';
    }
    /* Cap to keep the tool result compact. */
    return JSON.stringify(out.slice(0, 40));
}

async function execListDevices(ctx) {
    const instance = ctx.client.getInstance(ctx.guildId);
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const serverId = rustplus.serverId;
    const server = instance.serverList[serverId];
    if (!server) return 'No server configuration found.';

    const switches = Object.values(server.switches || {}).map(s => ({
        name: s.name, on: s.active, kind: 'switch'
    }));
    const alarms = Object.values(server.alarms || {}).map(a => ({
        name: a.name, kind: 'alarm'
    }));
    const devices = [...switches, ...alarms];
    if (devices.length === 0) return 'No smart devices configured.';
    return JSON.stringify(devices);
}

async function execSetSwitch(ctx, args) {
    if (!Config.ai.controlEnabled) return 'Device control is disabled in config.';
    if (!ctx.caller.canControl) return 'You do not have permission to control devices.';

    const name = (args.name || '').trim().toLowerCase();
    const on = args.on === true || args.on === 'true';
    if (name === '') return 'No switch name provided.';

    const instance = ctx.client.getInstance(ctx.guildId);
    const rustplus = getOperationalRustplus(ctx);
    if (!rustplus) return 'Not connected to a Rust server.';
    const server = instance.serverList[rustplus.serverId];
    const switches = server ? (server.switches || {}) : {};

    const entry = Object.entries(switches).find(([, s]) => s.name.toLowerCase() === name)
        || Object.entries(switches).find(([, s]) => s.name.toLowerCase().includes(name));
    if (!entry) return `No smart switch named "${args.name}".`;

    const [entityId, sw] = entry;
    try {
        const ok = await rustplus.turnSmartSwitchAsync(entityId, on);
        if (!await rustplus.isResponseValid(ok)) {
            return `Switch "${sw.name}" did not respond (device may be unpowered or out of range).`;
        }
        return `Switch "${sw.name}" turned ${on ? 'ON' : 'OFF'}.`;
    }
    catch (error) {
        return `Failed to toggle "${sw.name}": ${error.message}`;
    }
}

/* ------------------------------------------------------------------ */
/* Tool registry                                                       */
/* ------------------------------------------------------------------ */

const TOOLS = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_item',
                description: 'Get craft cost, recycle yield, research cost and raid/destroy options for a Rust item or building block. Use for any item/raid question.',
                parameters: {
                    type: 'object',
                    properties: { name: { type: 'string', description: 'Item or building block name, e.g. "Garage Door", "Sheet Metal Wall", "Rocket".' } },
                    required: ['name']
                }
            }
        },
        execute: execGetItem
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'search_items',
                description: 'Find exact item/building-block names that contain the given words. Use when get_item did not find a name, or to resolve slang/abbreviations to the real name before calling get_item.',
                parameters: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'Words to match against item names, e.g. "metal chest" or "rifle".' } },
                    required: ['query']
                }
            }
        },
        execute: execSearchItems
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'search_knowledge',
                description: 'Search the knowledge base (raid strategy, electricity, building tiers, general Rust info) by keywords.',
                parameters: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'Keywords to search for.' } },
                    required: ['query']
                }
            }
        },
        execute: execSearchKnowledge
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_team',
                description: 'Get current team members: name, online, alive, leader, and map grid position.',
                parameters: { type: 'object', properties: {} }
            }
        },
        execute: execGetTeam
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_server_info',
                description: 'Get live server info: player count, queue, map size, wipe time.',
                parameters: { type: 'object', properties: {} }
            }
        },
        execute: execGetServerInfo
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_time',
                description: 'Get current in-game time and whether it is day or night.',
                parameters: { type: 'object', properties: {} }
            }
        },
        execute: execGetTime
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_map_markers',
                description: 'Get active map markers. To answer "who sells X", "anyone selling X", "where can I buy X", set type="vending" AND item="<item name>" to get only the machines selling that item (price, stock, grid). Omit item to list all vending machines. Use "cargo"/"heli"/"crate"/"patrol" for events.',
                parameters: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: 'Filter: vending, cargo, ch47, crate, patrol, explosion.' },
                        item: { type: 'string', description: 'When type=vending, only return machines selling this item, e.g. "low grade fuel".' }
                    }
                }
            }
        },
        execute: execGetMapMarkers
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'list_devices',
                description: 'List configured smart switches (with on/off state) and alarms.',
                parameters: { type: 'object', properties: {} }
            }
        },
        execute: execListDevices
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'set_switch',
                description: 'Turn a smart switch ON or OFF by name. Only use when the user explicitly asks to control a device.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Smart switch name.' },
                        on: { type: 'boolean', description: 'true to turn on, false to turn off.' }
                    },
                    required: ['name', 'on']
                }
            }
        },
        execute: execSetSwitch
    }
];

module.exports = {
    /**
     * Tool definitions for the chat completion request.
     * @returns {Array<Object>}
     */
    getDefinitions: function () {
        return TOOLS.map(t => t.definition);
    },

    /**
     * Execute a tool call by name.
     * @param {string} name - Tool name
     * @param {Object} args - Parsed arguments
     * @param {Object} ctx - { client, guildId, caller: { steamId, discordId, canControl } }
     * @returns {Promise<string>} Tool result string
     */
    execute: async function (name, args, ctx) {
        const tool = TOOLS.find(t => t.definition.function.name === name);
        if (!tool) return `Unknown tool: ${name}`;
        try {
            return await tool.execute(ctx, args || {});
        }
        catch (error) {
            return `Tool "${name}" failed: ${error.message}`;
        }
    }
};
