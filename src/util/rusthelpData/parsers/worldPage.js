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

const BuildingPage = require('./buildingPage.js');

/**
 *  Parse a world entity page. World pages share the building page's name/slug shape and may
 *  also expose a raid/destruction table that contributes durability "other" records.
 *  @param {string} html The page HTML.
 *  @param {string} pageUrl The page URL/path.
 *  @param {Object} resolver The IdResolver.
 *  @return {Object|null} { name, slug, hp, durability } or null.
 */
function parseWorldPage(html, pageUrl, resolver) {
    /* World pages reuse the same server-rendered structure as building pages. */
    return BuildingPage.parseBuildingPage(html, pageUrl, resolver);
}

module.exports = { parseWorldPage };
