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

/*
    Headless CLI entry point for the rusthelp.com scraper.

    Examples:
      node src/util/rusthelpData/run.js --test
      node src/util/rusthelpData/run.js --limit=25
      node src/util/rusthelpData/run.js --test --dry-run --no-cache
      node src/util/rusthelpData/run.js                 (full scrape)
*/

const { runFullUpdate } = require('./index.js');

/**
 *  Parse simple CLI flags into an options object.
 *  @param {string[]} argv The argument vector (process.argv.slice(2)).
 *  @return {Object} The parsed options.
 */
function parseArgs(argv) {
    const options = { test: false, limit: null, dryRun: false, useCache: true };
    for (const arg of argv) {
        if (arg === '--test') options.test = true;
        else if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--no-cache') options.useCache = false;
        else if (arg.startsWith('--limit=')) {
            const n = parseInt(arg.split('=')[1], 10);
            if (!Number.isNaN(n)) options.limit = n;
        }
    }
    return options;
}

(async () => {
    const options = parseArgs(process.argv.slice(2));
    options.progress = (level, message) => {
        /* eslint-disable-next-line no-console */
        console.log(`[${String(level).toUpperCase()}] ${message}`);
    };
    try {
        const summary = await runFullUpdate(null, options);
        /* eslint-disable-next-line no-console */
        console.log('\n=== SUMMARY ===');
        /* eslint-disable-next-line no-console */
        console.log(JSON.stringify(summary, null, 2));
        process.exit(summary.success ? 0 : 1);
    } catch (error) {
        /* eslint-disable-next-line no-console */
        console.error('Scraper failed:', error);
        process.exit(1);
    }
})();
