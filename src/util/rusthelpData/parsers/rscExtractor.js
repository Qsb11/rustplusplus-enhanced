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
    rusthelp.com is a server-rendered Next.js application. The structured page data is
    streamed inside `self.__next_f.push([1,"..."])` script chunks (the React Server
    Components payload). This module reconstructs that payload and extracts the embedded
    JSON objects we care about (page item objects, building raid/destruction objects).
*/

/**
 *  Reconstruct the decoded RSC payload string from all __next_f push chunks in the HTML.
 *  @param {string} html The raw page HTML.
 *  @return {string} The concatenated, JSON-unescaped RSC payload.
 */
function decodeRscPayload(html) {
    const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    let m;
    let raw = '';
    while ((m = re.exec(html)) !== null) {
        raw += m[1];
    }
    if (raw === '') return '';
    try {
        return JSON.parse(`"${raw}"`);
    } catch (error) {
        /* Fallback manual unescape if the concatenation produced an invalid string literal. */
        return raw
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\u0026/g, '&')
            .replace(/\\\\/g, '\\');
    }
}

/**
 *  Given a string and the index of an opening brace, return the substring that forms the
 *  complete balanced JSON object (respecting strings and escapes).
 *  @param {string} str The source string.
 *  @param {number} start Index of the opening '{'.
 *  @return {string|null} The balanced object substring, or null if unbalanced.
 */
function extractBalancedObject(str, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < str.length; i++) {
        const c = str[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
        } else {
            if (c === '"') inString = true;
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return str.substring(start, i + 1);
            }
        }
    }
    return null;
}

/**
 *  Find and parse the first balanced JSON object that begins immediately after the given
 *  literal marker and that passes the supplied predicate.
 *  @param {string} payload The decoded RSC payload.
 *  @param {string} marker A literal marker that ends with the opening '{' position context.
 *  @param {function} [predicate] Optional (rawString) => boolean filter.
 *  @return {Object|null} The largest matching parsed object, or null.
 */
function findObjectByMarker(payload, marker, predicate) {
    let best = null;
    let idx = 0;
    const braceOffset = marker.lastIndexOf('{');
    while ((idx = payload.indexOf(marker, idx)) !== -1) {
        const objStart = braceOffset >= 0 ? idx + braceOffset : idx;
        const raw = extractBalancedObject(payload, objStart);
        idx = objStart + 1;
        if (!raw) continue;
        if (predicate && !predicate(raw)) continue;
        try {
            const parsed = JSON.parse(raw);
            if (!best || raw.length > best._rawLength) {
                best = parsed;
                Object.defineProperty(best, '_rawLength', { value: raw.length, enumerable: false });
            }
        } catch (error) {
            /* Not a standalone valid object (likely contained $L refs); skip. */
        }
    }
    return best;
}

/**
 *  Extract the canonical page item object from an item page payload.
 *  Identified by the `"item":{` marker on an object carrying both ingameId and shortName.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|null} The item object, or null if not present.
 */
function extractItemObject(payload) {
    return findObjectByMarker(payload, '"item":{',
        raw => raw.includes('"ingameId"') && raw.includes('"shortName"'));
}

/**
 *  Extract the building destruction/raid object from a building page payload.
 *  Identified by an object carrying `maxHealth` and a `raidingTable`.
 *  @param {string} payload The decoded RSC payload.
 *  @return {Object|null} The building object, or null if not present.
 */
function extractBuildingObject(payload) {
    return findObjectByMarker(payload, '{"maxHealth":',
        raw => raw.includes('raidingTable') || raw.includes('raidingCostCalculatorTable'));
}

/**
 *  Extract the balanced array/object starting at the given index.
 *  @param {string} str The source string.
 *  @param {number} start Index of the opening '[' or '{'.
 *  @return {string|null} The balanced substring, or null.
 */
function extractBalancedValue(str, start) {
    const open = str[start];
    if (open !== '[' && open !== '{') return null;
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < str.length; i++) {
        const c = str[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
        } else {
            if (c === '"') inString = true;
            else if (c === open) depth++;
            else if (c === close) {
                depth--;
                if (depth === 0) return str.substring(start, i + 1);
            }
        }
    }
    return null;
}

/**
 *  Parse an RSC payload row (lines of the form `<hexId>:<json>`).
 *  @param {string} payload The decoded RSC payload.
 *  @param {string} rowId The row id (hex string).
 *  @return {*} The parsed row value, or null.
 */
function getPayloadRow(payload, rowId) {
    const re = new RegExp(`(?:^|\\n)${rowId}:`);
    const idx = payload.search(re);
    if (idx === -1) return null;
    const start = payload.indexOf(':', idx === 0 ? 0 : idx + 1) + 1;
    const raw = extractBalancedValue(payload, start);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

/**
 *  Walk a path of segments through an RSC tree. React element nodes are encoded as
 *  ["$", tag, key, props]; a "props" segment on such a node resolves to index 3.
 *  @param {*} node The starting node.
 *  @param {string[]} segments Path segments.
 *  @return {*} The resolved value, or null.
 */
function walkRscPath(node, segments) {
    for (const seg of segments) {
        if (node === null || node === undefined) return null;
        if (Array.isArray(node) && node.length === 4 && node[0] === '$' && seg === 'props') {
            node = node[3];
            continue;
        }
        if (Array.isArray(node) && /^\d+$/.test(seg)) {
            node = node[Number(seg)];
            continue;
        }
        if (typeof node === 'object') {
            node = node[seg];
            continue;
        }
        return null;
    }
    return node;
}

/**
 *  Resolve an RSC string reference (e.g. "$52:1:props:children:0:props:data") against
 *  the payload it appears in. Some object fields (notably craftInfo.cost) are streamed
 *  as references into other payload rows instead of inline values.
 *  @param {string} payload The decoded RSC payload.
 *  @param {string} ref The reference string (must start with '$').
 *  @return {*} The resolved value, or null.
 */
function resolveReference(payload, ref) {
    if (typeof ref !== 'string' || !ref.startsWith('$')) return null;
    const parts = ref.slice(1).split(':');
    if (parts.length === 0) return null;
    const row = getPayloadRow(payload, parts[0]);
    if (row === null) return null;
    return walkRscPath(row, parts.slice(1));
}

/**
 *  Find the "data" values of RSC component rows identified by a literal marker (e.g.
 *  '"columnName":"Build Cost"'). Building-page build cost / upkeep / repair tables are
 *  streamed as sibling component props rather than fields of the building object; their
 *  shape is { ..., "data": <value>, ..., <marker> } so the nearest preceding "data": key
 *  before each marker occurrence carries the payload.
 *  @param {string} payload The decoded RSC payload.
 *  @param {string} marker The literal marker to search for.
 *  @return {Array} Parsed data values, one per marker occurrence (unparsable ones skipped).
 */
function findComponentData(payload, marker) {
    const results = [];
    let idx = 0;
    while ((idx = payload.indexOf(marker, idx)) !== -1) {
        const dataIdx = payload.lastIndexOf('"data":', idx);
        idx += marker.length;
        if (dataIdx === -1) continue;
        const valueStart = dataIdx + '"data":'.length;
        const raw = extractBalancedValue(payload, valueStart);
        if (!raw) continue;
        try {
            results.push(JSON.parse(raw));
        } catch (error) {
            /* Component data containing unresolved $refs is not standalone JSON; skip. */
        }
    }
    return results;
}

module.exports = {
    decodeRscPayload,
    extractBalancedObject,
    extractBalancedValue,
    findObjectByMarker,
    findComponentData,
    extractItemObject,
    extractBuildingObject,
    resolveReference
};
