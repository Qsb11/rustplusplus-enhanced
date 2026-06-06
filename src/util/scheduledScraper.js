/*
    Scheduled Item Scraper

    Runs the free rusthelp.com data scraper on a weekly schedule. The Firecrawl-based
    implementation has been removed; this delegates to src/util/rusthelpData (no API key
    required). The public surface (start/stop/runNow) is unchanged so existing callers
    (DiscordBot, ready event) keep working.
*/

const cron = require('node-cron');
const { runFullUpdate } = require('./rusthelpData/index.js');

class ScheduledScraper {
    constructor(client = null) {
        this.client = client;
        this.cronJob = null;
        this.running = false;
    }

    /**
     *  Run the full update once, guarding against overlapping runs.
     *  @return {Promise<Object|null>} The run summary, or null if a run was already in progress.
     */
    async run() {
        if (this.running) {
            console.log('Scheduled scraper already running, skipping overlap.');
            return null;
        }
        this.running = true;
        try {
            return await runFullUpdate(this.client, {
                progress: (level, message) => console.log(`[scraper:${level}] ${message}`)
            });
        } finally {
            this.running = false;
        }
    }

    start() {
        // Run every Sunday at 2 AM
        this.cronJob = cron.schedule('0 2 * * 0', async () => {
            console.log('Starting scheduled item scraping...');
            try {
                const summary = await this.run();
                console.log('Scheduled item scraping completed:', JSON.stringify(summary));
            } catch (error) {
                console.error('Scheduled item scraping failed:', error);
            }
        });

        console.log('Scheduled item scraper started - will run every Sunday at 2 AM');
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            console.log('Scheduled item scraper stopped');
        }
    }

    async runNow() {
        console.log('Running item scraper immediately...');
        try {
            const summary = await this.run();
            console.log('Manual item scraping completed:', JSON.stringify(summary));
            return summary;
        } catch (error) {
            console.error('Manual item scraping failed:', error);
            throw error;
        }
    }
}

module.exports = ScheduledScraper;
