/*
    /ai slash command — ask the AI assistant a Rust question.
    Uses any OpenAI-compatible endpoint configured via RPP_AI_* env vars.
*/

const Builder = require('@discordjs/builders');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const Ai = require('../util/ai');

const MAX_EMBED_DESCRIPTION = 4096;

module.exports = {
    name: 'ai',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('ai')
            .setDescription('Ask the AI assistant about Rust (raiding, crafting, electricity, ...)')
            .addStringOption(option =>
                option.setName('question')
                    .setDescription('Your question')
                    .setRequired(true));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply();

        const question = interaction.options.getString('question');
        /* Discord device control restricted to admins. */
        const canControl = client.isAdministrator(interaction);
        const result = await Ai.askAi(client, question, {
            source: 'discord',
            guildId: guildId,
            callerDiscordId: interaction.user.id,
            canControl: canControl
        });

        const embed = DiscordEmbeds.getEmbed({
            title: question.length > 250 ? `${question.slice(0, 250)}…` : question,
            description: result.answer.slice(0, MAX_EMBED_DESCRIPTION),
            color: result.success ? Constants.COLOR_DEFAULT : 0xff0000,
            timestamp: true
        });

        await client.interactionEditReply(interaction, { embeds: [embed] });
    }
};
