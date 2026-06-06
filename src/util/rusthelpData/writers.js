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

const Fs = require('fs');
const Path = require('path');

const STATIC_DIR = Path.join(__dirname, '..', '..', 'staticFiles');
const INDENT = 4;

/**
 *  Read and parse a static JSON file.
 *  @param {string} filename The file name within staticFiles.
 *  @param {*} [fallback={}] The value to return if the file does not exist.
 *  @return {*} The parsed JSON, or the fallback.
 */
function readStatic(filename, fallback = {}) {
    const p = Path.join(STATIC_DIR, filename);
    if (!Fs.existsSync(p)) return fallback;
    return JSON.parse(Fs.readFileSync(p, 'utf8'));
}

/**
 *  Atomically write a JSON object to a static file (write temp then rename) so an
 *  interrupted write can never leave a corrupt file in place.
 *  @param {string} filename The target file name within staticFiles.
 *  @param {*} data The JSON-serializable data.
 *  @return {void}
 */
function writeStaticAtomic(filename, data) {
    const target = Path.join(STATIC_DIR, filename);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(data, null, INDENT) + '\n';
    /* Validate the serialized output round-trips before committing it. */
    JSON.parse(json);
    Fs.writeFileSync(tmp, json, 'utf8');
    Fs.renameSync(tmp, target);
}

/**
 *  Assert that a generated entry has the same set of top-level keys as a reference entry.
 *  @param {string} label A human label for error messages.
 *  @param {Object} generated The generated entry.
 *  @param {Object} reference A reference (existing) entry.
 *  @return {string[]} An array of mismatch descriptions (empty when shapes match).
 */
function diffShape(label, generated, reference) {
    if (!reference || typeof reference !== 'object') return [];
    const gKeys = Object.keys(generated).sort();
    const rKeys = Object.keys(reference).sort();
    const issues = [];
    for (const k of rKeys) {
        if (!gKeys.includes(k)) issues.push(`${label}: generated missing key "${k}"`);
    }
    for (const k of gKeys) {
        if (!rKeys.includes(k)) issues.push(`${label}: generated has extra key "${k}"`);
    }
    return issues;
}

/**
 *  Merge new item-keyed entries into an existing object-of-objects file and write atomically.
 *  Existing entries whose source page was not scraped are preserved.
 *  @param {string} filename The target file name.
 *  @param {Object} newEntries The newly generated entries keyed by id.
 *  @param {Object} [opts] Options.
 *  @param {boolean} [opts.dryRun=false] When true, do not write; return the merged object.
 *  @param {function} [opts.log] Logging callback.
 *  @return {{ merged: Object, added: number, updated: number, shapeIssues: string[] }}
 */
function mergeKeyedFile(filename, newEntries, opts = {}) {
    const log = typeof opts.log === 'function' ? opts.log : (() => { });
    const existing = readStatic(filename, {});
    const merged = { ...existing };
    const refKeys = Object.keys(existing);
    const refEntry = refKeys.length > 0 ? existing[refKeys[0]] : null;

    let added = 0;
    let updated = 0;
    const shapeIssues = [];

    for (const [id, entry] of Object.entries(newEntries)) {
        if (refEntry) {
            const issues = diffShape(`${filename}[${id}]`, entry, refEntry);
            for (const issue of issues) {
                if (!shapeIssues.includes(issue)) shapeIssues.push(issue);
            }
        }
        if (Object.prototype.hasOwnProperty.call(existing, id)) updated++;
        else added++;
        merged[id] = entry;
    }

    if (!opts.dryRun) {
        writeStaticAtomic(filename, merged);
        log('info', `${filename}: +${added} new, ${updated} updated, ${Object.keys(merged).length} total`);
    }
    return { merged, added, updated, shapeIssues };
}

/**
 *  Merge new building/world section data ({items,buildingBlocks,other}) into a sectioned file
 *  (decay/upkeep/durability). Only provided fields are merged; missing data is preserved.
 *  @param {string} filename The target file name.
 *  @param {Object} contributions { items: {id:val}, buildingBlocks: {name:val}, other: {name:val} }.
 *  @param {Object} [opts] Options ({ dryRun, log, mergeFields }).
 *  @return {{ merged: Object, added: number, updated: number }}
 */
function mergeSectionedFile(filename, contributions, opts = {}) {
    const log = typeof opts.log === 'function' ? opts.log : (() => { });
    const existing = readStatic(filename, { items: {}, buildingBlocks: {}, other: {} });
    const merged = {
        items: { ...(existing.items || {}) },
        buildingBlocks: { ...(existing.buildingBlocks || {}) },
        other: { ...(existing.other || {}) }
    };

    let added = 0;
    let updated = 0;
    for (const section of ['items', 'buildingBlocks', 'other']) {
        const incoming = contributions[section] || {};
        for (const [key, value] of Object.entries(incoming)) {
            if (Object.prototype.hasOwnProperty.call(merged[section], key)) updated++;
            else added++;
            merged[section][key] = value;
        }
    }

    if (!opts.dryRun) {
        writeStaticAtomic(filename, merged);
        log('info', `${filename}: +${added} new, ${updated} updated`);
    }
    return { merged, added, updated };
}

module.exports = {
    STATIC_DIR,
    readStatic,
    writeStaticAtomic,
    diffShape,
    mergeKeyedFile,
    mergeSectionedFile
};
