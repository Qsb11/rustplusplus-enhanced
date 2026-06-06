/*
    AI chat client for rustplusplus.

    Talks to any OpenAI-compatible /chat/completions endpoint
    (Ollama, OpenAI, OpenRouter, Gemini, Anthropic compatibility layer, ...).
*/

const Axios = require('axios');

const Config = require('../../../config');

module.exports = {
    /**
     * Send a chat completion request to the configured endpoint.
     * @param {Array<{role: string, content: string}>} messages - Chat messages
     * @returns {Promise<string>} Assistant reply text
     * @throws {Error} On network/HTTP/format errors (caller handles user messaging)
     */
    chatCompletion: async function (messages) {
        const baseUrl = Config.ai.baseUrl.replace(/\/+$/, '');

        const headers = { 'Content-Type': 'application/json' };
        if (Config.ai.apiKey !== '') {
            headers['Authorization'] = `Bearer ${Config.ai.apiKey}`;
        }

        const response = await Axios.post(`${baseUrl}/chat/completions`, {
            model: Config.ai.model,
            messages: messages,
            max_tokens: Config.ai.maxTokens,
            temperature: Config.ai.temperature,
            stream: false
        }, {
            headers: headers,
            timeout: Config.ai.requestTimeoutMs
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content === '') {
            throw new Error('AI endpoint returned an empty or malformed response');
        }

        return content.trim();
    },

    /**
     * Whether the AI assistant is enabled via config.
     * @returns {boolean}
     */
    isEnabled: function () {
        return Config.ai.enabled === true;
    }
};
