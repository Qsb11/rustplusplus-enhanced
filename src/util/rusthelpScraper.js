/*
    Copyright (C) 2023 Nuallan Lampe (BigFatherJesus)
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
    Local base-material computation for the /chaincraft command. Previously this performed
    live per-request scraping of rusthelp.com; it now recurses the locally-cached crafting
    data (rustlabsCraftData.json via client.rustlabs) with zero network calls at command time.
    The exported signatures are unchanged so chaincraft.js keeps working.
*/

// Base resources and components that should not be broken down further
const BASE_MATERIALS = new Set([
    // Resources
    'Animal Fat', 'Bone Fragments', 'Charcoal', 'Cloth', 'Coal', 'Crude Oil',
    'Diesel Fuel', 'High Quality Metal Ore', 'Horse Dung', 'Leather', 'Low Grade Fuel',
    'Metal Fragments', 'Metal Ore', 'Plant Fiber', 'Radioactive Water', 'Salt Water',
    'Scrap', 'Stones', 'Sulfur', 'Sulfur Ore', 'Water', 'Wood', 'High Quality Metal',
    // Components
    'Gears', 'Metal Pipe', 'Metal Blade', 'Metal Spring', 'Road Signs', 'Sheet Metal',
    'Rope', 'Tarp', 'Sticks', 'Electric Fuse', 'Duct Tape', 'Glue', 'Sewing Kit',
    'Tech Trash', 'Empty Propane Tank'
]);

module.exports = {
    /**
     * Check if an item is a base material that shouldn't be broken down further
     * @param {string} itemName - The name of the item
     * @returns {boolean} True if the item is a base material
     */
    isBaseMaterial: function (itemName) {
        return BASE_MATERIALS.has(itemName);
    },

    /**
     * Get the shortname from an item name by searching the items.json
     * @param {Object} client - The Discord client
     * @param {string} itemName - The name of the item
     * @returns {string|null} The shortname of the item or null if not found
     */
    getItemShortname: function (client, itemName) {
        for (const [itemId, itemData] of Object.entries(client.items.items)) {
            if (itemData.name === itemName) {
                return itemData.shortname;
            }
        }
        return null;
    },

    /**
     * Get the item ID from an item name by searching the items.json
     * @param {Object} client - The Discord client
     * @param {string} itemName - The name of the item
     * @returns {string|null} The item ID or null if not found
     */
    getItemId: function (client, itemName) {
        for (const [itemId, itemData] of Object.entries(client.items.items)) {
            if (itemData.name === itemName) {
                return itemId;
            }
        }
        return null;
    },

    /**
     * Parse a quantity string that might contain K notation (e.g., "2.2K" = 2200)
     * @param {string} quantityStr - The quantity string to parse
     * @returns {number} The parsed quantity as a number
     */
    parseQuantity: function (quantityStr) {
        if (typeof quantityStr === 'number') return quantityStr;

        const str = quantityStr.toString().trim().replace(/,/g, '');

        if (str.toLowerCase().endsWith('k')) {
            const baseNumber = parseFloat(str.slice(0, -1));
            return Math.round(baseNumber * 1000);
        }

        return parseInt(str) || 0;
    },

    /**
     * Get base materials for an item by recursively decomposing the local crafting data.
     * No network calls are performed. Recursion stops at base materials (see BASE_MATERIALS)
     * or at items with no known crafting recipe.
     * @param {Object} client - The Discord client (provides client.items and client.rustlabs)
     * @param {string} itemId - The item ID
     * @param {number} quantity - The quantity needed
     * @param {Object} visited - Object to track visited items to prevent infinite loops
     * @returns {Object|null} Object mapping itemId -> { name, quantity } of base materials
     */
    getBaseMaterials: function (client, itemId, quantity, visited = {}) {
        // Prevent infinite loops on cyclic recipes
        if (visited[itemId]) {
            return {};
        }
        visited = { ...visited, [itemId]: true };

        const itemName = client.items.getName(itemId);
        if (!itemName) {
            client.log(client.intlGet(null, 'warningCap'), `Item with ID ${itemId} not found`);
            return null;
        }

        // Treat declared base materials as leaves
        if (this.isBaseMaterial(itemName)) {
            return { [itemId]: { name: itemName, quantity: quantity } };
        }

        // Look up the crafting recipe from local data
        const craftDetails = client.rustlabs.getCraftDetailsById(itemId);
        if (craftDetails === null) {
            // Not craftable -> it is itself a base material
            return { [itemId]: { name: itemName, quantity: quantity } };
        }

        const [, , craftData] = craftDetails;
        if (!craftData || !Array.isArray(craftData.ingredients) || craftData.ingredients.length === 0) {
            return { [itemId]: { name: itemName, quantity: quantity } };
        }

        const baseMaterials = {};
        for (const ingredient of craftData.ingredients) {
            const ingredientId = ingredient.id;
            const ingredientQuantity = ingredient.quantity * quantity;
            const ingredientName = client.items.getName(ingredientId);

            if (ingredientName && this.isBaseMaterial(ingredientName)) {
                if (baseMaterials[ingredientId]) {
                    baseMaterials[ingredientId].quantity += ingredientQuantity;
                } else {
                    baseMaterials[ingredientId] = { name: ingredientName, quantity: ingredientQuantity };
                }
                continue;
            }

            const sub = this.getBaseMaterials(client, ingredientId, ingredientQuantity, visited);
            if (sub) {
                for (const [baseId, baseData] of Object.entries(sub)) {
                    if (baseMaterials[baseId]) {
                        baseMaterials[baseId].quantity += baseData.quantity;
                    } else {
                        baseMaterials[baseId] = { ...baseData };
                    }
                }
            }
        }

        return baseMaterials;
    }
};
