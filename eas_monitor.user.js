// ==UserScript==
// @name         EAS Milan TOEIC Availability Monitor
// @namespace    https://eas-milan.org/
// @version      2.2.0
// @description  Monitora automaticamente la pagina TOEIC EAS Milan per posti disponibili. Banner sempre visibile con conteggio esauriti e timer refresh.
// @author       EAS Monitor
// @match        *://eas-milan.org/*
// @match        *://*.eas-milan.org/*
// @icon         https://eas-milan.org/themes/eas/images/logo.png
// @grant        none
// @run-at       document-end
// @noframes
// ==/UserScript==

/* jshint esversion: 6 */

(function () {
    'use strict';

    // Startup immediato — se vedi questo in console, lo script è attivo
    console.log('%c[EAS Monitor v2.1.0] Script AVVIATO', 'color: #27ae60; font-size: 16px; font-weight: bold;');
    console.log('[EAS Monitor] URL corrente:', window.location.href);

    // ── CONFIGURAZIONE ──────────────────────────────────────────────
    var REFRESH_INTERVAL_SEC = 5;
    var ENABLE_SOUND = true;
    var ENABLE_TAB_FLASH = true;
    var SOUND_FREQUENCY = 800;
    var SOUND_DURATION_MS = 200;
    var SOUND_REPEAT = 5;

    // ── STATO ────────────────────────────────────────────────────────
    var refreshTimerId = null;
    var countdownId = null;
    var elapsedId = null;
    var tabFlashId = null;
    var originalTitle = document.title;

    // ── UTILITÀ ──────────────────────────────────────────────────────

    function getTimestamp() {
        var d = new Date();
        return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatElapsed(seconds) {
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        var ss = s < 10 ? '0' + s : '' + s;
        if (m > 0) return m + 'm ' + ss + 's';
        return s + 's';
    }

    // ── PARSING ──────────────────────────────────────────────────────

    function parseAllSessions() {
        var rows = document.querySelectorAll('div.riga_tabella');
        console.log('[EAS Monitor] Trovate ' + rows.length + ' righe div.riga_tabella');

        var sessions = [];
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var descDiv = row.querySelector('div.tabelladescrizione');
            var noteDiv = row.querySelector('div.tabellanote');
            var buyDiv = row.querySelector('div.tabellaacquista');

            var description = descDiv ? descDiv.textContent.trim() : 'N/A';
            var note = noteDiv ? noteDiv.textContent.trim() : '';
            var buyLink = buyDiv ? buyDiv.querySelector('a') : null;
            var hasBuyLink = buyLink !== null;
            var buyUrl = buyLink ? buyLink.href : null;

            var isSoldOut = note.toLowerCase().indexOf('esaurito') !== -1;
            var isAvailable = !isSoldOut || hasBuyLink;
            var hasLastSpots = /ultim\w*\s+\d+\s+post/i.test(note);

            sessions.push({
                description: description,
                note: note,
                hasBuyLink: hasBuyLink,
                buyUrl: buyUrl,
                isSoldOut: isSoldOut,
                isAvailable: isAvailable,
                hasLastSpots: hasLastSpots
            });
        }
        return sessions;
    }

    // ── STILI ────────────────────────────────────────────────────────

    function injectStyles() {
        var style = document.createElement('style');
        style.textContent = [
            '@keyframes eas-glow { 0%,100%{box-shadow:0 4px 20px rgba(40,167,69,0.4)} 50%{box-shadow:0 4px 30px rgba(40,167,69,0.8)} }',
            '#eas-banner { position:fixed; top:0; left:0; right:0; z-index:2147483647; padding:10px 20px; font-family:"Segoe UI",Arial,sans-serif; font-size:14px; text-align:center; display:flex; align-items:center; justify-content:center; gap:16px; flex-wrap:wrap; box-shadow:0 3px 15px rgba(0,0,0,0.35); }',
            '#eas-banner.sold-out { background:linear-gradient(135deg,#b71c1c,#e53935); color:#fff; }',
            '#eas-banner.available { background:linear-gradient(135deg,#1b5e20,#43a047); color:#fff; animation:eas-glow 2s ease-in-out infinite; }',
            '#eas-banner .badge { background:rgba(255,255,255,0.2); padding:5px 14px; border-radius:20px; font-weight:bold; font-size:15px; }',
            '#eas-banner .info { font-size:13px; opacity:0.95; }',
            '#eas-banner .info strong { color:#fff; }',
            '#eas-banner button { background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.5); color:#fff; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold; }',
            '#eas-banner button:hover { background:rgba(255,255,255,0.4); }',
            '#eas-details { position:fixed; top:48px; left:0; right:0; z-index:2147483646; background:linear-gradient(135deg,#1b5e20,#2e7d32); color:#fff; padding:8px 20px; font-family:"Segoe UI",Arial,sans-serif; font-size:14px; text-align:center; box-shadow:0 2px 10px rgba(0,0,0,0.2); }',
            '#eas-details a { color:#ffeb3b; font-weight:bold; text-decoration:underline; }',
            '#eas-details a:hover { color:#fff; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── BANNER ───────────────────────────────────────────────────────

    function renderBanner(total, soldOut, availCount, availSessions) {
        // Rimuovi precedenti
        var old1 = document.getElementById('eas-banner');
        if (old1) old1.remove();
        var old2 = document.getElementById('eas-details');
        if (old2) old2.remove();

        var allSoldOut = availCount === 0;
        var banner = document.createElement('div');
        banner.id = 'eas-banner';
        banner.className = allSoldOut ? 'sold-out' : 'available';

        var icon = allSoldOut ? '🔴' : '🟢';
        var statusText = allSoldOut
            ? soldOut + '/' + total + ' Esaurito'
            : availCount + ' DISPONIBILE/I!';

        banner.innerHTML = [
            '<span class="badge">' + icon + ' ' + statusText + '</span>',
            '<span class="info">🕐 Check: <strong id="eas-ts">' + getTimestamp() + '</strong> — <strong id="eas-elapsed">0s</strong> fa</span>',
            '<span class="info">⏱️ Prossimo: <strong id="eas-cd">' + REFRESH_INTERVAL_SEC + 's</strong></span>',
            '<button id="eas-btn">🔄 Refresh</button>'
        ].join(' ');

        document.body.insertBefore(banner, document.body.firstChild);

        // Padding per non coprire il contenuto
        document.body.style.marginTop = '52px';

        // Pulsante refresh
        document.getElementById('eas-btn').addEventListener('click', function () {
            if (refreshTimerId) clearTimeout(refreshTimerId);
            if (countdownId) clearInterval(countdownId);
            if (elapsedId) clearInterval(elapsedId);
            window.location.reload();
        });

        // Timer elapsed
        var elapsedSec = 0;
        if (elapsedId) clearInterval(elapsedId);
        elapsedId = setInterval(function () {
            elapsedSec++;
            var el = document.getElementById('eas-elapsed');
            if (el) el.textContent = formatElapsed(elapsedSec);
        }, 1000);

        // Countdown
        var remaining = REFRESH_INTERVAL_SEC;
        if (countdownId) clearInterval(countdownId);

        if (allSoldOut) {
            countdownId = setInterval(function () {
                remaining--;
                var cdEl = document.getElementById('eas-cd');
                if (cdEl) {
                    cdEl.textContent = remaining + 's';
                    if (remaining <= 10) cdEl.style.color = '#ffcdd2';
                }
            }, 1000);
        } else {
            var cdEl = document.getElementById('eas-cd');
            if (cdEl) cdEl.textContent = 'PAUSA';
        }

        // Dettagli disponibili
        if (!allSoldOut && availSessions.length > 0) {
            var details = document.createElement('div');
            details.id = 'eas-details';
            var html = '';
            for (var i = 0; i < availSessions.length; i++) {
                var s = availSessions[i];
                html += '<div style="margin:3px 0">📅 <strong>' + s.description + '</strong>';
                if (s.hasLastSpots) html += ' — ⚠️ <em>' + s.note + '</em>';
                if (s.buyUrl) html += ' — <a href="' + s.buyUrl + '">🛒 ACQUISTA ORA →</a>';
                html += '</div>';
            }
            details.innerHTML = html;
            banner.insertAdjacentElement('afterend', details);
            document.body.style.marginTop = '96px';
        }

        console.log('[EAS Monitor] Banner renderizzato: ' + (allSoldOut ? 'TUTTO ESAURITO' : 'DISPONIBILI!'));
    }

    // ── SUONO ────────────────────────────────────────────────────────

    function playBeep() {
        if (!ENABLE_SOUND) return;
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            for (var i = 0; i < SOUND_REPEAT; i++) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'square';
                osc.frequency.value = SOUND_FREQUENCY + (i * 100);
                gain.gain.value = 0.3;
                var t0 = ctx.currentTime + (i * 0.3);
                osc.start(t0);
                osc.stop(t0 + SOUND_DURATION_MS / 1000);
            }
        } catch (e) {
            console.warn('[EAS Monitor] Audio fallito:', e);
        }
    }

    function flashTab() {
        if (!ENABLE_TAB_FLASH) return;
        if (tabFlashId) clearInterval(tabFlashId);
        var v = true;
        tabFlashId = setInterval(function () {
            document.title = v ? '🎯 POSTO DISPONIBILE!' : originalTitle;
            v = !v;
        }, 800);
    }

    // ── CHECK PRINCIPALE ─────────────────────────────────────────────

    function runCheck() {
        try {
            console.log('[EAS Monitor] [' + getTimestamp() + '] Inizio scan...');

            var sessions = parseAllSessions();
            var available = [];
            for (var i = 0; i < sessions.length; i++) {
                if (sessions[i].isAvailable) available.push(sessions[i]);
            }
            var soldOut = sessions.length - available.length;

            console.log('[EAS Monitor] Totale: ' + sessions.length + ' | Esaurito: ' + soldOut + ' | Disponibili: ' + available.length);

            // Stampa le prime 3 sessioni per debug
            for (var j = 0; j < Math.min(3, sessions.length); j++) {
                console.log('[EAS Monitor]   es. ' + (j + 1) + ': "' + sessions[j].description.substring(0, 60) + '" | note="' + sessions[j].note + '" | sold=' + sessions[j].isSoldOut);
            }

            // Renderizza SEMPRE il banner
            renderBanner(sessions.length, soldOut, available.length, available);

            if (available.length > 0) {
                console.log('%c[EAS Monitor] 🎯 POSTI DISPONIBILI!', 'color: #27ae60; font-size: 18px; font-weight: bold;');
                for (var k = 0; k < available.length; k++) {
                    console.log('  → ' + available[k].description + ' | ' + available[k].note);
                }
                // Stop auto-refresh
                if (refreshTimerId) { clearTimeout(refreshTimerId); refreshTimerId = null; }
                playBeep();
                flashTab();
            } else {
                console.log('[EAS Monitor] Tutto esaurito. Prossimo check: ' + REFRESH_INTERVAL_SEC + 's');
                refreshTimerId = setTimeout(function () {
                    window.location.reload();
                }, REFRESH_INTERVAL_SEC * 1000);
            }
        } catch (err) {
            console.error('[EAS Monitor] ERRORE:', err);
        }
    }

    // ── AVVIO ────────────────────────────────────────────────────────

    function waitForDOM() {
        // Aspetta che le div.riga_tabella esistano (max 10s)
        var attempts = 0;
        var maxAttempts = 20;

        function check() {
            attempts++;
            var rows = document.querySelectorAll('div.riga_tabella');
            console.log('[EAS Monitor] Tentativo ' + attempts + '/' + maxAttempts + ' — trovate ' + rows.length + ' righe');

            if (rows.length > 0) {
                console.log('[EAS Monitor] DOM pronto, avvio check...');
                runCheck();
            } else if (attempts < maxAttempts) {
                setTimeout(check, 500);
            } else {
                console.error('[EAS Monitor] Nessuna riga trovata dopo ' + maxAttempts + ' tentativi!');
                // Mostra banner di errore comunque
                renderBanner(0, 0, 0, []);
            }
        }

        check();
    }

    try {
        injectStyles();
        waitForDOM();
    } catch (e) {
        console.error('[EAS Monitor] Errore fatale all\'avvio:', e);
    }

})();
