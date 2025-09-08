/*
    Auto-Reconnection Manager for RustPlus Bot
    Automatically reconnects to last connected server when bot is disconnected
*/

const Config = require('../../config');

class AutoReconnectManager {
    constructor(client) {
        this.client = client;
        this.intervalId = null;
        this.checkInterval = 30000; // Check every 30 seconds (more responsive)
        this.isRunning = false;
    }

    /**
     * Start the auto-reconnection manager
     */
    start() {
        if (this.intervalId) {
            this.stop();
        }

        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.checkAndReconnect();
        }, this.checkInterval);

        this.client.log(this.client.intlGet(null, 'infoCap'), 
            `Auto-reconnection manager started with ${this.checkInterval}ms interval`);
    }

    /**
     * Stop the auto-reconnection manager
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.isRunning = false;
            this.client.log(this.client.intlGet(null, 'infoCap'), 
                'Auto-reconnection manager stopped');
        }
    }

    /**
     * Check all guilds and reconnect if needed
     */
    async checkAndReconnect() {
        if (!this.isRunning) return;

        const guilds = this.client.guilds.cache;
        
        for (const [guildId, guild] of guilds) {
            try {
                await this.checkGuildConnection(guildId);
            } catch (error) {
                this.client.log(this.client.intlGet(null, 'errorCap'), 
                    `Auto-reconnection check failed for guild ${guildId}: ${error.message}`);
            }
        }
    }

    /**
     * Check if a guild should be connected and reconnect if needed
     * @param {string} guildId - Guild ID to check
     */
    async checkGuildConnection(guildId) {
        // Skip if already reconnecting
        if (this.client.rustplusReconnecting[guildId]) {
            return;
        }

        // Get guild instance configuration
        const instance = this.client.getInstance(guildId);
        if (!instance) {
            return;
        }

        // Check if guild has an active server configured
        if (!instance.activeServer || !instance.serverList[instance.activeServer]) {
            return;
        }

        // Check if we should be connected but aren't
        const shouldBeConnected = instance.activeServer !== null;
        const isCurrentlyConnected = this.client.activeRustplusInstances[guildId] && 
                                   this.client.rustplusInstances[guildId] &&
                                   this.client.rustplusInstances[guildId].isOperational;

        if (shouldBeConnected && !isCurrentlyConnected) {
            // Check if this looks like a server restart (common time for Rust servers)
            const now = new Date();
            const isLikelyServerRestartTime = this.isLikelyServerRestartTime(now);
            
            if (isLikelyServerRestartTime) {
                this.client.log(this.client.intlGet(null, 'infoCap'), 
                    `Detected likely server restart time for guild ${guildId}, prioritizing reconnection`);
            }

            this.client.log(this.client.intlGet(null, 'infoCap'), 
                `Auto-reconnecting guild ${guildId} to server ${instance.activeServer}`);
            
            await this.reconnectGuild(guildId, instance);
        }
    }

    /**
     * Check if current time is likely a server restart time
     * Most Rust servers restart daily around midnight or early morning hours
     * @param {Date} now - Current time
     * @returns {boolean} - Whether this is likely a server restart time
     */
    isLikelyServerRestartTime(now) {
        const hour = now.getHours();
        const minute = now.getMinutes();
        
        // Common server restart times:
        // - Midnight (00:00-01:00)
        // - Early morning (02:00-06:00) 
        // - Or if it's exactly on the hour (many servers restart hourly)
        return (hour >= 0 && hour <= 6) || (minute >= 0 && minute <= 5);
    }

    /**
     * Reconnect a guild to its active server using the EXACT same logic as manual reconnect button
     * @param {string} guildId - Guild ID
     * @param {Object} instance - Guild instance configuration
     */
    async reconnectGuild(guildId, instance) {
        const serverId = instance.activeServer;
        const serverInfo = instance.serverList[serverId];
        
        if (!serverInfo) {
            this.client.log(this.client.intlGet(null, 'errorCap'), 
                `No server info found for active server ${serverId} in guild ${guildId}`);
            return;
        }

        try {
            this.client.log(this.client.intlGet(null, 'infoCap'), 
                `Starting auto-reconnection for guild ${guildId} to server ${serverId} (${serverInfo.serverIp}:${serverInfo.appPort})`);

            // EXACT SEQUENCE FROM WORKING MANUAL BUTTON (buttonHandler.js:428-458)
            
            // Step 1: Reset rustplus variables (same as manual reconnect)
            this.client.resetRustplusVariables(guildId);

            // Step 2: Get current rustplus instance for cleanup
            const rustplus = this.client.rustplusInstances[guildId];

            // Step 3: Send server message if activeServer exists (same as manual reconnect)
            if (instance.activeServer !== null) {
                const DiscordMessages = require('../discordTools/discordMessages.js');
                await DiscordMessages.sendServerMessage(guildId, instance.activeServer, null);
            }

            // Step 4: Set active server (ensuring consistency)
            instance.activeServer = serverId;
            this.client.setInstance(guildId, instance);

            // Step 5: Disconnect previous instance if any (EXACT same as manual reconnect)
            if (rustplus) {
                rustplus.isDeleted = true;
                rustplus.disconnect();
                // CRITICAL: Delete the instance from the collection (this was missing!)
                delete this.client.rustplusInstances[guildId];
            }

            // Step 6: Create the rustplus instance (same as manual reconnect)
            const newRustplus = this.client.createRustplusInstance(
                guildId, 
                serverInfo.serverIp, 
                serverInfo.appPort, 
                serverInfo.steamId, 
                serverInfo.playerToken
            );

            // Step 7: Send server message to update Discord UI (same as manual reconnect)
            if (newRustplus) {
                const DiscordMessages = require('../discordTools/discordMessages.js');
                await DiscordMessages.sendServerMessage(guildId, serverId, null, null);
            }

            // Step 8: Mark as new connection (same as manual reconnect)
            if (newRustplus) {
                newRustplus.isNewConnection = true;
            }

            this.client.log(this.client.intlGet(null, 'infoCap'), 
                `Auto-reconnection initiated successfully for guild ${guildId}`);
            
        } catch (error) {
            this.client.log(this.client.intlGet(null, 'errorCap'), 
                `Auto-reconnection failed for guild ${guildId}: ${error.message}`);
            
            // Clear reconnecting flag on error
            this.client.rustplusReconnecting[guildId] = false;
        }
    }

    /**
     * Force reconnect a specific guild
     * @param {string} guildId - Guild ID to force reconnect
     */
    async forceReconnectGuild(guildId) {
        const instance = this.client.getInstance(guildId);
        if (instance && instance.activeServer) {
            this.client.log(this.client.intlGet(null, 'infoCap'), 
                `Force reconnecting guild ${guildId}`);
            await this.reconnectGuild(guildId, instance);
        }
    }

    /**
     * Get auto-reconnection statistics
     * @returns {Object} - Statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            checkInterval: this.checkInterval,
            nextCheck: this.intervalId ? Date.now() + this.checkInterval : null
        };
    }
}

module.exports = AutoReconnectManager;