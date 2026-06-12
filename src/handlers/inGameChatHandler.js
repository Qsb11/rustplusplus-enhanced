/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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

const Constants = require("../util/constants");

/* Characters Rust's team chat renders as '?' (or that read badly in-game), with safe
   replacements. Semicolons are filtered by the game client; typographic punctuation
   comes from AI answers. */
const GAME_CHAT_CHAR_MAP = {
    ';': ',',
    '–': '-',  /* en dash */
    '—': '-',  /* em dash */
    '×': 'x',
    '≈': '~',
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '•': '-',
    '…': '...',
    ' ': ' '
};

module.exports = {
    inGameChatHandler: async function (rustplus, client, message = null) {
        const guildId = rustplus.guildId;
        const generalSettings = rustplus.generalSettings;
        const commandDelayMs = parseInt(generalSettings.commandDelay) * 1000;
        const trademark = generalSettings.trademark;
        const trademarkString = (trademark === 'NOT SHOWING') ? '' : `${trademark} | `;
        const messageMaxLength = Constants.MAX_LENGTH_TEAM_MESSAGE - trademarkString.length;

        /* Time to write a message from the queue. If message === null, that means that its a timer call. */
        if (message === null) {
            if (rustplus.inGameChatQueue.length !== 0) {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;

                const messageFromQueue = rustplus.inGameChatQueue[0];
                rustplus.inGameChatQueue = rustplus.inGameChatQueue.slice(1);

                rustplus.updateBotMessages(messageFromQueue);

                rustplus.sendTeamMessageAsync(messageFromQueue);
                rustplus.log(client.intlGet(guildId, 'messageCap'), messageFromQueue);
            }
            else {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;
            }
        }

        /* if there is a new message, add message to queue. */
        if (message !== null) {
            if (rustplus.team === null || rustplus.team.allOffline ||
                rustplus.generalSettings.muteInGameBotMessages) {
                return;
            }

            if (Array.isArray(message)) {
                for (const msg of message) {
                    handleMessage(rustplus, msg, trademarkString, messageMaxLength)
                }
            }
            else if (typeof message === 'string') {
                handleMessage(rustplus, message, trademarkString, messageMaxLength)
            }
        }

        /* Start new timer? */
        if (rustplus.inGameChatQueue.length !== 0 && rustplus.inGameChatTimeout === null) {
            rustplus.inGameChatTimeout = setTimeout(module.exports.inGameChatHandler, commandDelayMs, rustplus, client);
        }
    },
};

function handleMessage(rustplus, message, trademarkString, maxLength) {
    if (typeof message !== 'string') return;

    for (const str of chunkForGameChat(sanitizeForGameChat(message), maxLength)) {
        rustplus.inGameChatQueue.push(`${trademarkString}${str}`);
    }
}

/**
 *  Replace characters the in-game chat cannot render and flatten newlines (game chat
 *  is single-line; AI answers may contain lists).
 *  @param {string} message The raw message.
 *  @return {string} The sanitized single-line message.
 */
function sanitizeForGameChat(message) {
    let out = message.replace(/\s*\n+\s*/g, ' | ');
    for (const [bad, good] of Object.entries(GAME_CHAT_CHAR_MAP)) {
        out = out.split(bad).join(good);
    }
    return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 *  Split a message into game-chat-sized chunks at natural boundaries (sentence, list
 *  item, word) instead of mid-item, so multi-part lists stay readable.
 *  @param {string} message The sanitized message.
 *  @param {number} maxLength Max characters per chunk.
 *  @return {string[]} The chunks (never empty for non-empty input).
 */
function chunkForGameChat(message, maxLength) {
    const chunks = [];
    let rest = message;
    while (rest.length > maxLength) {
        const window = rest.slice(0, maxLength + 1);
        let cut = -1;
        /* Prefer the latest natural boundary, but not so early the chunk gets tiny. */
        for (const sep of ['. ', ', ', ' | ', ' ']) {
            const idx = window.lastIndexOf(sep);
            if (idx >= Math.floor(maxLength * 0.5)) {
                cut = sep === ' ' ? idx : idx + 1; /* Keep '.'/','/'|' with the left chunk. */
                break;
            }
        }
        if (cut <= 0) cut = maxLength; /* No boundary at all — hard cut. */
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).replace(/^[|,.\s]+/, '');
    }
    if (rest.length > 0) chunks.push(rest);
    return chunks;
}
