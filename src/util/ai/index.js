/*
    AI assistant orchestrator.

    askAi() runs an agentic loop: the model can call tools (live server data,
    item/knowledge lookups, device control) before answering. Used by the
    in-game !ai command and the /ai Discord slash command.
*/

const Config = require('../../../config');
const AiClient = require('./client.js');
const Knowledge = require('./knowledge.js');
const Tools = require('./tools.js');

/* Shared behaviour rules baked into every system prompt. */
const RULES =
    'You are a Rust (the survival game) expert assistant. Use the tools to look up ' +
    'live server data, item/raid data and knowledge before answering. ' +
    'CRITICAL: report the EXACT numbers from tool results — never round, estimate, ' +
    'average, or invent quantities. If a tool says 4 satchels, say 4, not "2-3". ' +
    'The "fastest" method is the one with the lowest "time" value, not the lowest ' +
    'sulfur. Be as concise as possible: shortest sentences, plain language, no filler, ' +
    'no preamble. State the answer directly. ' +
    'destroyOptions is a ranked list of real raid methods (cheapest sulfur first). ' +
    'For a normal raid pick the FASTEST (lowest time). For "cheapest" pick the lowest ' +
    'sulfurCost. Quote tool, quantity, time and sulfur exactly. ' +
    'To answer what is for sale, who sells an item, or where to buy something, call ' +
    'get_map_markers with type "vending" and read the "sells" lists — that is live ' +
    'vending machine data, not "player sales you cannot see". ' +
    'Players use slang and abbreviations (e.g. "AK" = Assault Rifle, "bolty" = Bolt ' +
    'Action Rifle, "full metal kit" = a gear loadout). If get_item does not find a ' +
    'name, DO NOT give up: search_knowledge for "slang" or "kits" to translate the ' +
    'term, and/or call search_items to find the real name, then retry get_item with ' +
    'the corrected name. A "kit" or "set" is multiple items: first read its component ' +
    'list from search_knowledge (the slang/kits doc), then call get_item for EACH ' +
    'component to get real costs, and sum them multiplied by the requested quantity. ' +
    'NEVER state a craft cost, recipe, or quantity from your own memory or "standard ' +
    'recipes" — every number MUST come from a get_item result. If you have not called ' +
    'get_item for an item yet, call it; do not guess. Keep trying alternative names a ' +
    'few times before concluding something cannot be found.';

const IN_GAME_SYSTEM_PROMPT = RULES +
    ' Output plain text only (no markdown, no bullet lists). Keep it to one or two short sentences.';

const DISCORD_SYSTEM_PROMPT = RULES +
    ' Compact Discord markdown allowed. Keep it under ~120 words.';

module.exports = {
    /**
     * Ask the AI assistant a question.
     * @param {Object} client - Discord client
     * @param {string} question - The user's question
     * @param {Object} [options] - { source, guildId, callerSteamId, callerDiscordId, canControl }
     * @returns {Promise<{success: boolean, answer: string}>}
     */
    askAi: async function (client, question, options = {}) {
        const source = options.source ?? 'discord';

        if (!AiClient.isEnabled()) {
            return { success: false, answer: 'AI assistant is disabled (RPP_AI_ENABLED=false).' };
        }

        const trimmedQuestion = (question ?? '').trim();
        if (trimmedQuestion === '') {
            return { success: false, answer: 'Ask a question, e.g: cheapest way to raid a stone wall?' };
        }

        const systemPrompt = source === 'ingame' ? IN_GAME_SYSTEM_PROMPT : DISCORD_SYSTEM_PROMPT;

        const ctx = {
            client,
            guildId: options.guildId ?? null,
            caller: {
                steamId: options.callerSteamId ?? null,
                discordId: options.callerDiscordId ?? null,
                canControl: options.canControl === true
            }
        };

        const useTools = Config.ai.toolsEnabled && ctx.guildId !== null;

        const messages = [{ role: 'system', content: systemPrompt }];

        /* Static context as a fallback hint (also helps models with weak tool use).
           Tools provide the authoritative live data. */
        if (!useTools) {
            let staticContext = '';
            try { staticContext = Knowledge.buildContext(client, trimmedQuestion); }
            catch (error) { /* non-fatal */ }
            messages.push({
                role: 'user',
                content: staticContext !== ''
                    ? `CONTEXT:\n${staticContext}\n\nQUESTION: ${trimmedQuestion}`
                    : `QUESTION: ${trimmedQuestion}`
            });
        }
        else {
            messages.push({ role: 'user', content: trimmedQuestion });
        }

        try {
            const answer = useTools
                ? await runToolLoop(client, ctx, messages)
                : await AiClient.chatCompletion(messages);
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

/**
 * Run the tool-calling loop until the model produces a final answer or the
 * iteration cap is hit.
 * @returns {Promise<string>} Final answer text
 */
async function runToolLoop(client, ctx, messages) {
    const toolDefs = Tools.getDefinitions();

    for (let iteration = 0; iteration < Config.ai.maxToolIterations; iteration++) {
        const { message } = await AiClient.createChatCompletion(messages, { tools: toolDefs });

        const toolCalls = message.tool_calls;
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
            /* Final answer. */
            return (message.content || '').trim() || 'No answer produced.';
        }

        /* Record the assistant's tool-call turn, then append each tool result. */
        messages.push(message);

        for (const call of toolCalls) {
            const name = call.function?.name;
            let args = {};
            try {
                const raw = call.function?.arguments;
                args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
            }
            catch (error) {
                args = {};
            }

            const result = await Tools.execute(name, args, ctx);
            client.log(client.intlGet(null, 'infoCap'), `AI tool call: ${name}(${JSON.stringify(args)})`);

            messages.push({
                role: 'tool',
                tool_call_id: call.id || name,
                content: typeof result === 'string' ? result : JSON.stringify(result)
            });
        }
    }

    /* Iteration cap hit — ask once more for a plain answer without tools. */
    const final = await AiClient.chatCompletion(messages);
    return final || 'Could not complete the request.';
}
