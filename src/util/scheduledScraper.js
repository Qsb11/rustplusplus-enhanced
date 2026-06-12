/*
    Scheduled Item Scraper

    Runs the free rusthelp.com data scraper on a weekly schedule. The Firecrawl-based
    implementation has been removed; this delegates to src/util/rusthelpData (no API key
    required). The public surface (start/stop/runNow) is unchanged so existing callers
    (DiscordBot, ready event) keep working.
*/

const cron = require('node-cron');
const { runFullUpdate } = require('./rusthelpData/index.js');

/* Scheduled runs re-fetch cache entries older than this so wipe-day scrapes actually pick
   up game-patch changes instead of re-parsing the same HTML forever. */
const SCHEDULED_CACHE_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/* Rust wipes land on Thursdays (force wipe: first Thursday of the month, 19:00 UTC;
   most community servers wipe the same evening). Scraping early Friday morning gives
   rusthelp.com time to publish the patch's data changes. Override with RPP_SCRAPER_CRON. */
const DEFAULT_SCRAPE_CRON = '0 5 * * 5';

class ScheduledScraper {
    constructor(client = null) {
        this.client = client;
        this.cronJob = null;
        this.running = false;
    }

    /**
     *  Log through the Discord client's logger when available so failures are visible
     *  in the bot's log channel/file, falling back to the console.
     *  @param {string} level 'info' | 'error'.
     *  @param {string} message The message.
     */
    _log(level, message) {
        if (this.client && typeof this.client.log === 'function') {
            try {
                this.client.log(level === 'error' ? 'ERROR' : 'INFO', `[scraper] ${message}`);
                return;
            } catch (error) { /* fall through to console */ }
        }
        if (level === 'error') console.error(message);
        else console.log(message);
    }

    /**
     *  Run the full update once, guarding against overlapping runs.
     *  @param {Object} [options] Extra options forwarded to runFullUpdate.
     *  @return {Promise<Object|null>} The run summary, or null if a run was already in progress.
     */
    async run(options = {}) {
        if (this.running) {
            this._log('info', 'Scheduled scraper already running, skipping overlap.');
            return null;
        }
        this.running = true;
        try {
            return await runFullUpdate(this.client, {
                progress: (level, message) => console.log(`[scraper:${level}] ${message}`),
                ...options
            });
        } finally {
            this.running = false;
        }
    }

    start() {
        let schedule = process.env.RPP_SCRAPER_CRON || DEFAULT_SCRAPE_CRON;
        if (!cron.validate(schedule)) {
            this._log('error', `Invalid RPP_SCRAPER_CRON "${schedule}", falling back to "${DEFAULT_SCRAPE_CRON}".`);
            schedule = DEFAULT_SCRAPE_CRON;
        }
        // Default: every Friday 05:00 (the morning after Thursday wipes/force wipes).
        this.cronJob = cron.schedule(schedule, async () => {
            this._log('info', 'Starting scheduled item scraping...');
            try {
                const summary = await this.run({ cacheMaxAgeMs: SCHEDULED_CACHE_MAX_AGE_MS });
                if (!summary || !summary.success) {
                    this._log('error', `Scheduled item scraping was not successful: ${JSON.stringify(summary)}`);
                } else {
                    this._log('info', `Scheduled item scraping completed: ${JSON.stringify(summary)}`);
                }
            } catch (error) {
                this._log('error', `Scheduled item scraping failed: ${error.message}`);
            }
        });

        this._log('info', `Scheduled item scraper started (cron "${process.env.RPP_SCRAPER_CRON || DEFAULT_SCRAPE_CRON}" - default: Friday 05:00, after Thursday wipes)`);
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
