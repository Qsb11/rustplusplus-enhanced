/*
    Short-term conversation memory for the AI assistant.

    Keeps a small rolling window of recent (question, answer) pairs per
    conversation so follow-up questions have context ("what about a garage
    door?"). In-memory only — cleared on restart, expired after idle TTL.

    We store only final Q&A text, not the intermediate tool-call turns: the
    model re-runs tools fresh each query, so replaying old tool exchanges would
    waste tokens and risk stale data.
*/

const Config = require('../../../config');

/* convId -> { turns: [{ role, content }], lastUsed: epochMs } */
const conversations = new Map();

module.exports = {
    /**
     * Get prior conversation turns for a conversation id (expired/empty -> []).
     * @param {string} convId
     * @param {number} now - Current epoch ms (passed in; Date.now() avoided for testability)
     * @returns {Array<{role: string, content: string}>}
     */
    getHistory: function (convId, now) {
        if (!convId) return [];
        const entry = conversations.get(convId);
        if (!entry) return [];
        if (now - entry.lastUsed > Config.ai.memoryTtlMs) {
            conversations.delete(convId);
            return [];
        }
        return entry.turns;
    },

    /**
     * Append a question/answer pair to a conversation, trimming to the window.
     * @param {string} convId
     * @param {string} question
     * @param {string} answer
     * @param {number} now - Current epoch ms
     */
    append: function (convId, question, answer, now) {
        if (!convId) return;
        const entry = conversations.get(convId) || { turns: [], lastUsed: now };
        entry.turns.push({ role: 'user', content: question });
        entry.turns.push({ role: 'assistant', content: answer });

        /* Keep the last N pairs (2 messages per pair). */
        const maxMessages = Config.ai.memoryTurns * 2;
        if (entry.turns.length > maxMessages) {
            entry.turns = entry.turns.slice(entry.turns.length - maxMessages);
        }
        entry.lastUsed = now;
        conversations.set(convId, entry);
    },

    /**
     * Clear a conversation (e.g. on explicit reset).
     * @param {string} convId
     */
    clear: function (convId) {
        conversations.delete(convId);
    }
};
