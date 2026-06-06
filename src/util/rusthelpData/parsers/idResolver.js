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
    rusthelp.com uses its own string item identifiers (e.g. "metal-refined") which do NOT
    match the bot's in-game shortnames (e.g. "metal.refined"). However the human-readable
    `displayName` ("High Quality Metal") matches items.json `name` exactly, and rusthelp
    item objects expose the numeric `ingameId`. This resolver maps a rusthelp item link to
    the bot's numeric item ID (as a string), preferring the scraped ingameId map and falling
    back to displayName lookups against the existing items.json.
*/

/**
 *  IdResolver maps rusthelp item references to the bot's numeric item IDs.
 */
class IdResolver {

    /**
     *  @param {Object} existingItems The existing items.json object ({numericId: {shortname, name, description}}).
     */
    constructor(existingItems) {
        this._byName = new Map();
        this._byShortname = new Map();
        for (const [id, item] of Object.entries(existingItems || {})) {
            if (item && typeof item.name === 'string') this._byName.set(item.name, id);
            if (item && typeof item.shortname === 'string') this._byShortname.set(item.shortname, id);
        }
        /* rusthelp string id -> numeric ingameId discovered during the scrape. */
        this._byRusthelpId = new Map();
    }

    /**
     *  Register a discovered mapping from a rusthelp string id to a numeric ingameId.
     *  @param {string} rusthelpId The rusthelp string identifier (e.g. "metal-refined").
     *  @param {number|string} ingameId The numeric in-game id.
     *  @return {void}
     */
    register(rusthelpId, ingameId) {
        if (typeof rusthelpId === 'string' && ingameId !== undefined && ingameId !== null) {
            this._byRusthelpId.set(rusthelpId, String(ingameId));
        }
    }

    /**
     *  Resolve a rusthelp itemLink/cost entry to the bot numeric id (string).
     *  @param {Object} link An object that may carry { id, displayName } (an itemLink) or { itemId, itemLink }.
     *  @return {string|null} The numeric id as a string, or null if unresolved.
     */
    resolve(link) {
        if (!link) return null;
        const rusthelpId = link.id || link.itemId || (link.itemLink && link.itemLink.id);
        const displayName = link.displayName || (link.itemLink && link.itemLink.displayName);

        if (rusthelpId && this._byRusthelpId.has(rusthelpId)) {
            return this._byRusthelpId.get(rusthelpId);
        }
        if (displayName && this._byName.has(displayName)) {
            return this._byName.get(displayName);
        }
        return null;
    }

    /**
     *  Resolve a workbench level (1-3) to the corresponding workbench item id.
     *  @param {number|null} level The workbench level.
     *  @return {string|null} The workbench item numeric id, or null.
     */
    resolveWorkbenchLevel(level) {
        const map = { 1: 'Workbench Level 1', 2: 'Workbench Level 2', 3: 'Workbench Level 3' };
        const name = map[level];
        return name && this._byName.has(name) ? this._byName.get(name) : null;
    }

    /**
     *  @return {boolean} Whether a numeric id exists for the given displayName.
     */
    hasName(name) {
        return this._byName.has(name);
    }
}

module.exports = { IdResolver };
