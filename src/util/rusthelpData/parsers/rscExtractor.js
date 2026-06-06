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

module.exports = {
    decodeRscPayload,
    extractBalancedObject,
    findObjectByMarker,
    extractItemObject,
    extractBuildingObject
};
