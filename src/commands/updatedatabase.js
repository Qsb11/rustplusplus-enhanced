/*
    Copyright (C) 2024 Nuallan

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

const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const { runFullUpdate } = require('../util/rusthelpData/index.js');

module.exports = {
    name: 'updatedatabase',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('updatedatabase')
            .setDescription(client.intlGet(guildId, 'commandsUpdateDatabaseDesc') || 'Update the Rust item database')
            .addStringOption(option => option
                .setName('target')
                .setDescription(client.intlGet(guildId, 'commandsUpdateDatabaseTargetDesc') || 'What to update')
                .setRequired(true)
                .addChoices(
                    { name: 'All Items (Full Scrape)', value: 'ALL' },
                    { name: 'New Items Only', value: 'NEW' },
                    { name: 'Specific Item', value: 'ITEM' }
                ))
            .addStringOption(option => option
                .setName('item-name')
                .setDescription(client.intlGet(guildId, 'commandsUpdateDatabaseItemDesc') || 'Name of specific item to update')
                .setRequired(false));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        // Check permissions (admin only)
        if (!interaction.member.permissions.has('Administrator')) {
            const str = client.intlGet(guildId, 'missingPermission') || 'You need Administrator permissions to use this command.';
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str, null, guildId));
            client.log(client.intlGet(guildId, 'warningCap'), str);
            return;
        }

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getString('target');
        const itemName = interaction.options.getString('item-name');

        // Validate input
        if (target === 'ITEM' && !itemName) {
            const str = client.intlGet(guildId, 'commandsUpdateDatabaseMissingItem') || 'You must specify an item name when updating a specific item.';
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str, null, guildId));
            client.log(client.intlGet(guildId, 'warningCap'), str);
            return;
        }

        // Initial response
        const initialMessage = this.getInitialMessage(client, guildId, target, itemName);
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, initialMessage, null, guildId));

        try {
            const options = { progress: (level, message) => client.log(client.intlGet(guildId, 'infoCap'), message) };

            if (target === 'ITEM') {
                /* Scrape a single item by its rusthelp slug derived from the provided name. */
                const slug = itemName.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                options.test = false;
                options.itemSlugs = [slug];
            }
            /* ALL and NEW both perform a full merge-based update (merge never drops existing entries). */

            const summary = await runFullUpdate(client, options);

            if (summary && summary.success) {
                let successMessage = this.getSuccessMessage(client, guildId, target, summary, itemName);
                successMessage += '\n\n🔄 Item data reloaded - new items are now available in commands!';
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, successMessage, null, guildId));
                client.log(client.intlGet(guildId, 'infoCap'), successMessage);
            } else {
                const errorMessage = client.intlGet(guildId, 'commandsUpdateDatabaseNotSuccessful') ||
                    '❌ The database update was not successful. Please try again later.';
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, errorMessage, null, guildId));
                client.log(client.intlGet(guildId, 'warningCap'), errorMessage);
            }
        } catch (error) {
            client.log(client.intlGet(guildId, 'errorCap'), `Database update error: ${error.message}`);
            const errorMessage = client.intlGet(guildId, 'commandsUpdateDatabaseError') ||
                'An unexpected error occurred during the database update.';
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, errorMessage, null, guildId));
        }
    },

    getInitialMessage(client, guildId, target, itemName) {
        switch (target) {
            case 'ALL':
                return client.intlGet(guildId, 'commandsUpdateDatabaseStartingAll') ||
                    '🔄 Starting full database update. This may take several minutes...';
            case 'NEW':
                return client.intlGet(guildId, 'commandsUpdateDatabaseStartingNew') ||
                    '🔄 Checking for new items in the database...';
            case 'ITEM':
                return client.intlGet(guildId, 'commandsUpdateDatabaseStartingItem', { item: itemName }) ||
                    `🔄 Updating item "${itemName}"...`;
            default:
                return 'Starting database update...';
        }
    },

    getSuccessMessage(client, guildId, target, summary, itemName) {
        switch (target) {
            case 'ALL':
                return client.intlGet(guildId, 'commandsUpdateDatabaseSuccessAll', {
                    total: summary.totalItems,
                    errors: summary.itemErrors || 0
                }) || `✅ Successfully updated the item database (${summary.totalItems} items, ${summary.itemErrors || 0} errors).`;
            case 'NEW':
                if (summary.newItems > 0) {
                    return client.intlGet(guildId, 'commandsUpdateDatabaseSuccessNew', { count: summary.newItems }) ||
                        `✅ Found and added ${summary.newItems} new items to the database.`;
                }
                return client.intlGet(guildId, 'commandsUpdateDatabaseNoNewItems') ||
                    '✅ No new items found. The database is up to date.';
            case 'ITEM':
                return client.intlGet(guildId, 'commandsUpdateDatabaseSuccessItem', {
                    item: itemName,
                    id: 'updated'
                }) || `✅ Successfully updated item: **${itemName}** (${summary.updatedItems} entries refreshed).`;
            default:
                return 'Database update completed successfully.';
        }
    }
};
