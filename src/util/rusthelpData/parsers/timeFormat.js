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

/**
 *  Format a duration into the compact "X sec" / "X min Y sec" / "X hour" style used by the
 *  existing durability/craft data files.
 *  @param {number} seconds The duration in seconds.
 *  @return {string} The formatted time string.
 */
function formatDurabilityTime(seconds) {
    const s = Math.round(seconds || 0);
    if (s === 0) return '0 sec';
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} min`);
    if (secs > 0) parts.push(`${secs} sec`);
    return parts.length > 0 ? parts.join(' ') : '0 sec';
}

/**
 *  Format a despawn duration into the "X sec" / "X min" / "X hour" style used by the
 *  existing despawn data file (single dominant unit).
 *  @param {number} seconds The duration in seconds.
 *  @return {string} The formatted despawn string.
 */
function formatDespawnTime(seconds) {
    const s = Math.round(seconds || 0);
    if (s % 3600 === 0 && s >= 3600) {
        const h = s / 3600;
        return `${h} hour${h > 1 ? 's' : ''}`;
    }
    if (s % 60 === 0 && s >= 60) {
        return `${s / 60} min`;
    }
    return `${s} sec`;
}

/**
 *  Format a craft time into a short string (e.g. "45 sec", "2 min 5 sec").
 *  @param {number} seconds The craft time in seconds.
 *  @return {string} The formatted craft time string.
 */
function formatCraftTime(seconds) {
    const s = Math.round(seconds || 0);
    if (s === 0) return '0 sec';
    if (s < 60) return `${s} sec`;
    const minutes = Math.floor(s / 60);
    const secs = s % 60;
    return secs > 0 ? `${minutes} min ${secs} sec` : `${minutes} min`;
}

/**
 *  Format a decay duration into the "X min" / "X hour" / "X day" style used by the
 *  existing decay data file.
 *  @param {number} seconds The duration in seconds.
 *  @return {string} The formatted decay string.
 */
function formatDecayTime(seconds) {
    const s = Math.round(seconds || 0);
    if (s % 86400 === 0 && s >= 86400) {
        const d = s / 86400;
        return `${d} day${d > 1 ? 's' : ''}`;
    }
    if (s % 3600 === 0 && s >= 3600) {
        const h = s / 3600;
        return `${h} hour${h > 1 ? 's' : ''}`;
    }
    if (s % 60 === 0 && s >= 60) {
        return `${s / 60} min`;
    }
    return `${s} sec`;
}

module.exports = { formatDurabilityTime, formatDespawnTime, formatCraftTime, formatDecayTime };
