/*
    Copyright (C) 2024 Nuallan Lampe (BigFatherJesus)
    Enhanced fork of rustplusplus by Alexander Emanuelsson (alexemanuelol)

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

const Axios = require('axios');
const Fs = require('fs');
const Path = require('path');

const BASE_URL = 'https://rusthelp.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) rustplusplus-bot';
const RATE_LIMIT_MS = 300;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30000;
const CACHE_DIR = Path.join(__dirname, '.cache');

/**
 *  Simple sleep helper.
 *  @param {number} ms Milliseconds to sleep.
 *  @return {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 *  Fetcher handles all HTTP access to rusthelp.com with rate limiting, retry/backoff
 *  and an on-disk HTML cache so a scrape run can resume after interruption.
 */
class Fetcher {

    /**
     *  @param {Object} [options] Optional configuration.
     *  @param {boolean} [options.useCache=true] Whether to read/write the on-disk cache.
     *  @param {function} [options.log] Logging callback (level, message).
     */
    constructor(options = {}) {
        this.useCache = options.useCache !== false;
        this.log = typeof options.log === 'function' ? options.log : (() => { });
        this._lastRequestTime = 0;

        if (this.useCache && !Fs.existsSync(CACHE_DIR)) {
            Fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
    }

    /**
     *  Convert a URL/slug into a safe cache filename.
     *  @param {string} key The cache key (typically a URL path).
     *  @return {string} Absolute path to the cache file.
     */
    _cachePath(key) {
        const safe = key.replace(/[^a-z0-9._-]/gi, '_');
        return Path.join(CACHE_DIR, `${safe}.html`);
    }

    /**
     *  Enforce the minimum delay between outbound requests.
     *  @return {Promise<void>}
     */
    async _throttle() {
        const elapsed = Date.now() - this._lastRequestTime;
        if (elapsed < RATE_LIMIT_MS) {
            await sleep(RATE_LIMIT_MS - elapsed);
        }
        this._lastRequestTime = Date.now();
    }

    /**
     *  Fetch the sitemap and return the list of absolute page URLs it contains.
     *  @return {Promise<string[]>} Array of URLs.
     */
    async fetchSitemap() {
        const xml = await this.fetchRaw(`${BASE_URL}/sitemap.xml`, 'sitemap.xml');
        if (!xml) return [];
        const urls = [];
        const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
            urls.push(m[1].trim());
        }
        return urls;
    }

    /**
     *  Fetch a page by its rusthelp path (e.g. "/items/assault-rifle"), using cache when enabled.
     *  @param {string} pathOrUrl The path or absolute URL.
     *  @return {Promise<string|null>} The HTML body, or null on permanent failure.
     */
    async fetchPage(pathOrUrl) {
        const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
        const cacheKey = url.replace(`${BASE_URL}/`, '').replace(/\/$/, '') || 'index';

        if (this.useCache) {
            const cachePath = this._cachePath(cacheKey);
            if (Fs.existsSync(cachePath)) {
                try {
                    return Fs.readFileSync(cachePath, 'utf8');
                } catch (error) {
                    this.log('warning', `Failed to read cache for ${url}: ${error.message}`);
                }
            }
        }

        const html = await this.fetchRaw(url, cacheKey);
        return html;
    }

    /**
     *  Perform the raw HTTP GET with retry/backoff. Writes to cache on success when enabled.
     *  @param {string} url The absolute URL to fetch.
     *  @param {string} cacheKey The cache key to store under.
     *  @return {Promise<string|null>} The response body, or null on permanent failure.
     */
    async fetchRaw(url, cacheKey) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await this._throttle();
                const response = await Axios.get(url, {
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: { 'User-Agent': USER_AGENT },
                    validateStatus: status => status >= 200 && status < 300
                });

                const body = response.data;
                if (this.useCache && cacheKey && typeof body === 'string') {
                    try {
                        Fs.writeFileSync(this._cachePath(cacheKey), body, 'utf8');
                    } catch (error) {
                        this.log('warning', `Failed to write cache for ${url}: ${error.message}`);
                    }
                }
                return typeof body === 'string' ? body : JSON.stringify(body);
            } catch (error) {
                const status = error.response ? error.response.status : null;
                /* Do not retry client errors other than 429. */
                if (status && status !== 429 && status >= 400 && status < 500) {
                    this.log('warning', `Permanent HTTP ${status} for ${url}, skipping.`);
                    return null;
                }
                if (attempt === MAX_RETRIES) {
                    this.log('error', `Failed to fetch ${url} after ${MAX_RETRIES + 1} attempts: ${error.message}`);
                    return null;
                }
                const backoff = RATE_LIMIT_MS * Math.pow(2, attempt + 1);
                this.log('warning', `Fetch error for ${url} (attempt ${attempt + 1}): ${error.message}, retrying in ${backoff}ms`);
                await sleep(backoff);
            }
        }
        return null;
    }

    /**
     *  Clear the on-disk cache directory.
     *  @return {void}
     */
    clearCache() {
        if (Fs.existsSync(CACHE_DIR)) {
            for (const file of Fs.readdirSync(CACHE_DIR)) {
                try {
                    Fs.unlinkSync(Path.join(CACHE_DIR, file));
                } catch (error) {
                    this.log('warning', `Failed to delete cache file ${file}: ${error.message}`);
                }
            }
        }
    }
}

module.exports = { Fetcher, BASE_URL, USER_AGENT, RATE_LIMIT_MS, CACHE_DIR, sleep };
