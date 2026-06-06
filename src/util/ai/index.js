/*
    AI assistant orchestrator.

    askAi() builds a prompt from retrieved game data + knowledge documents and
    queries the configured OpenAI-compatible endpoint. Used by the in-game
    !ai command and the /ai Discord slash command.
*/

const AiClient = require('./client.js');
const Knowledge = require('./knowledge.js');

const IN_GAME_SYSTEM_PROMPT =
    'You are a Rust (the survival game) expert assistant inside a team chat. ' +
    'Answer using ONLY the provided context where possible; if data is missing say so briefly. ' +
    'Be extremely concise: short sentences, no markdown, no lists with bullets — plain text only. ' +
    'Maximum a few sentences. Quantities and sulfur costs matter most.';

const DISCORD_SYSTEM_PROMPT =
    'You are a Rust (the survival game) expert assistant for a Discord server. ' +
    'Answer using ONLY the provided context where possible; if data is missing say so briefly. ' +
    'Use compact Discord markdown. Keep answers under 300 words. ' +
    'Quantities, sulfur costs and crafting chains matter most.';

module.exports = {
    /**
     * Ask the AI assistant a question.
     * @param {Object} client - Discord client
     * @param {string} question - The user's question
     * @param {Object} [options] - { source: 'ingame' | 'discord' }
     * @returns {Promise<{success: boolean, answer: string}>}
     */
    askAi: async function (client, question, options = {}) {
        const source = options.source ?? 'discord';

        if (!AiClient.isEnabled()) {
            return { success: false, answer: 'AI assistant is disabled (RPP_AI_ENABLED=false).' };
        }

        const trimmedQuestion = (question ?? '').trim();
        if (trimmedQuestion === '') {
            return { success: false, answer: 'Ask a question, e.g: what is the cheapest way to raid a stone wall?' };
        }

        let context = '';
        try {
            context = Knowledge.buildContext(client, trimmedQuestion);
        }
        catch (error) {
            client.log(client.intlGet(null, 'warningCap'), `AI context retrieval failed: ${error.message}`);
        }

        const systemPrompt = source === 'ingame' ? IN_GAME_SYSTEM_PROMPT : DISCORD_SYSTEM_PROMPT;
        const userContent = context !== ''
            ? `CONTEXT:\n${context}\n\nQUESTION: ${trimmedQuestion}`
            : `QUESTION: ${trimmedQuestion}`;

        try {
            const answer = await AiClient.chatCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ]);
            return { success: true, answer: answer };
        }
        catch (error) {
            client.log(client.intlGet(null, 'errorCap'), `AI request failed: ${error.message}`, 'error');
            return {
                success: false,
                answer: 'AI request failed — check that the configured endpoint is reachable.'
            };
        }
    }
};
