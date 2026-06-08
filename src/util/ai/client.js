/*
    AI chat client for rustplusplus.

    Talks to any OpenAI-compatible /chat/completions endpoint
    (Ollama, OpenAI, OpenRouter, Gemini, Anthropic compatibility layer, ...).
*/

const Axios = require('axios');

const Config = require('../../../config');

/* Transient statuses worth retrying: rate limit + server overload/unavailable. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    /**
     * Send a chat completion request to the configured endpoint.
     * @param {Array<{role: string, content: string}>} messages - Chat messages
     * @returns {Promise<string>} Assistant reply text
     * @throws {Error} On network/HTTP/format errors (caller handles user messaging)
     */
    chatCompletion: async function (messages) {
        const choice = await module.exports.createChatCompletion(messages);
        const content = choice.message?.content;
        if (typeof content !== 'string' || content === '') {
            throw new Error('AI endpoint returned an empty or malformed response');
        }
        return content.trim();
    },

    /**
     * Low-level chat completion. Returns the raw assistant message so callers
     * can handle tool calls. Optionally sends tool definitions.
     * @param {Array<Object>} messages - Chat messages
     * @param {Object} [opts] - { tools: Array<Object> }
     * @returns {Promise<{message: Object, finishReason: string}>}
     * @throws {Error} On network/HTTP/format errors
     */
    createChatCompletion: async function (messages, opts = {}) {
        const baseUrl = Config.ai.baseUrl.replace(/\/+$/, '');

        const headers = { 'Content-Type': 'application/json' };
        if (Config.ai.apiKey !== '') {
            headers['Authorization'] = `Bearer ${Config.ai.apiKey}`;
        }

        const payload = {
            model: Config.ai.model,
            messages: messages,
            max_tokens: Config.ai.maxTokens,
            temperature: Config.ai.temperature,
            stream: false
        };
        if (Array.isArray(opts.tools) && opts.tools.length > 0) {
            payload.tools = opts.tools;
        }

        let lastError = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await Axios.post(`${baseUrl}/chat/completions`, payload, {
                    headers: headers,
                    timeout: Config.ai.requestTimeoutMs
                });

                const choice = response.data?.choices?.[0];
                if (!choice || !choice.message) {
                    throw new Error('AI endpoint returned an empty or malformed response');
                }
                return { message: choice.message, finishReason: choice.finish_reason };
            }
            catch (error) {
                lastError = error;
                const status = error.response ? error.response.status : null;
                if (!status || !RETRYABLE_STATUS.has(status) || attempt === MAX_RETRIES) {
                    throw error;
                }
                /* Honor Retry-After when present (rate limit), else exponential backoff. */
                const retryAfter = parseInt(error.response?.headers?.['retry-after'], 10);
                const backoff = (!isNaN(retryAfter) && retryAfter > 0)
                    ? retryAfter * 1000
                    : 1000 * Math.pow(2, attempt); /* 1s, 2s, 4s */
                await sleep(backoff);
            }
        }
        throw lastError;
    },

    /**
     * Whether the AI assistant is enabled via config.
     * @returns {boolean}
     */
    isEnabled: function () {
        return Config.ai.enabled === true;
    }
};
