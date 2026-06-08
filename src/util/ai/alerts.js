/*
    Proactive AI commentary on notable in-game events (e.g. raid/smart alarms).

    Opt-in via RPP_AI_ALERTS_ENABLED. When an event fires, the AI is given the
    event plus access to live tools (team status, etc.) and posts a short
    tactical heads-up in team chat. Best-effort and fully guarded — never throws
    into the event pipeline.
*/

const Config = require('../../../config');
const Ai = require('./index.js');

module.exports = {
    /**
     * Generate and post an AI tactical note for a triggered smart/raid alarm.
     * @param {Object} client - Discord client
     * @param {Object} rustplus - The operational RustPlus instance
     * @param {string} alarmName
     * @param {string} alarmMessage
     */
    onSmartAlarm: async function (client, rustplus, alarmName, alarmMessage) {
        if (!Config.ai.alertsEnabled) return;
        if (!rustplus || rustplus.isDeleted || !rustplus.isOperational) return;

        const question =
            `A smart alarm just triggered. Alarm name: "${alarmName}". ` +
            `Alarm message: "${alarmMessage}". This usually means a base event or a raid. ` +
            `Check who on the team is online and where, then give ONE short tactical ` +
            `heads-up for the team. Plain text, one sentence.`;

        try {
            const result = await Ai.askAi(client, question, {
                source: 'ingame',
                guildId: rustplus.guildId,
                canControl: false,
                conversationId: null /* don't pollute user conversation memory */
            });
            if (result.success && result.answer && !rustplus.isDeleted && rustplus.isOperational) {
                rustplus.sendInGameMessage(`AI: ${result.answer}`);
            }
        }
        catch (error) {
            client.log(client.intlGet(null, 'warningCap'), `AI alarm alert failed: ${error.message}`);
        }
    }
};
