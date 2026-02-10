// ==UserScript==
// @name         EAS Milan TOEIC Availability Monitor
// @namespace    https://eas-milan.org/
// @version      1.0.0
// @description  Monitora automaticamente la pagina TOEIC EAS Milan per posti disponibili. Alert visivo e sonoro quando un esame non è esaurito.
// @author       EAS Monitor
// @match        https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2
// @match        https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2*
// @icon         https://eas-milan.org/themes/eas/images/logo.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ── CONFIGURAZIONE ──────────────────────────────────────────────
    const CONFIG = {
        REFRESH_INTERVAL_SEC: 90,       // Intervallo auto-refresh in secondi
        ENABLE_SOUND: true,             // Abilita alert sonoro
        ENABLE_BANNER: true,            // Abilita banner visivo
        ENABLE_TAB_FLASH: true,         // Abilita flash del titolo tab
        SOUND_FREQUENCY: 800,           // Frequenza beep (Hz)
        SOUND_DURATION_MS: 200,         // Durata beep (ms)
        SOUND_REPEAT: 5,               // Numero ripetizioni beep
    };

    // ── STATO ────────────────────────────────────────────────────────
    let refreshTimer = null;
    let tabFlashTimer = null;
    const originalTitle = document.title;

    // ── PARSING ──────────────────────────────────────────────────────

    function parseAllSessions() {
        const rows = document.querySelectorAll('div.riga_tabella');
        const sessions = [];

        rows.forEach((row) => {
            const descDiv = row.querySelector('div.tabelladescrizione');
            const noteDiv = row.querySelector('div.tabellanote');
            const buyDiv = row.querySelector('div.tabellaacquista');

            const description = descDiv ? descDiv.textContent.trim() : 'N/A';
            const note = noteDiv ? noteDiv.textContent.trim() : '';
            const buyLink = buyDiv ? buyDiv.querySelector('a') : null;
            const hasBuyLink = buyLink !== null;
            const buyUrl = buyLink ? buyLink.href : null;

            const isSoldOut = note.toLowerCase().includes('esaurito');
            const isAvailable = !isSoldOut || hasBuyLink;
            const hasLastSpots = /ultim\w*\s+\d+\s+post/i.test(note);

            sessions.push({
                description,
                note,
                hasBuyLink,
                buyUrl,
                isSoldOut,
                isAvailable,
                hasLastSpots,
            });
        });

        return sessions;
    }

    function findAvailable(sessions) {
        return sessions.filter((s) => s.isAvailable);
    }

    // ── NOTIFICHE ────────────────────────────────────────────────────

    function playBeepSequence() {
        if (!CONFIG.ENABLE_SOUND) return;

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        for (let i = 0; i < CONFIG.SOUND_REPEAT; i++) {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'square';
            oscillator.frequency.value = CONFIG.SOUND_FREQUENCY + (i * 100);
            gainNode.gain.value = 0.3;

            const startTime = audioCtx.currentTime + (i * (CONFIG.SOUND_DURATION_MS + 100) / 1000);
            const stopTime = startTime + CONFIG.SOUND_DURATION_MS / 1000;

            oscillator.start(startTime);
            oscillator.stop(stopTime);
        }
    }

    function showBanner(available) {
        if (!CONFIG.ENABLE_BANNER) return;

        // Rimuovi banner precedente se presente
        const existing = document.getElementById('eas-monitor-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'eas-monitor-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            padding: 20px;
            font-family: Arial, sans-serif;
            font-size: 18px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: eas-pulse 1s ease-in-out infinite alternate;
        `;

        // Animazione CSS
        const style = document.createElement('style');
        style.textContent = `
            @keyframes eas-pulse {
                from { opacity: 0.85; transform: scale(1); }
                to   { opacity: 1; transform: scale(1.01); }
            }
            #eas-monitor-banner a {
                color: white;
                text-decoration: underline;
                font-weight: bold;
            }
        `;
        document.head.appendChild(style);

        let content = `<h2 style="margin:0 0 10px 0;">🎯 ${available.length} POSTO/I DISPONIBILE/I!</h2>`;
        available.forEach((s) => {
            let line = `<div style="margin:4px 0;">📅 <strong>${s.description}</strong>`;
            if (s.hasLastSpots) line += ` ⚠️ <em>${s.note}</em>`;
            if (s.buyUrl) line += ` — <a href="${s.buyUrl}">ACQUISTA ORA →</a>`;
            line += '</div>';
            content += line;
        });
        content += `<div style="margin-top:10px;font-size:14px;opacity:0.8;">Auto-refresh disattivato. Agisci subito!</div>`;

        banner.innerHTML = content;
        document.body.prepend(banner);

        // Scroll in cima
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function flashTab() {
        if (!CONFIG.ENABLE_TAB_FLASH) return;

        let visible = true;
        tabFlashTimer = setInterval(() => {
            document.title = visible
                ? '🎯 POSTO DISPONIBILE! — EAS TOEIC'
                : originalTitle;
            visible = !visible;
        }, 800);
    }

    function showStatusIndicator(totalSessions, availableCount) {
        // Rimuovi indicatore precedente
        const existing = document.getElementById('eas-monitor-status');
        if (existing) existing.remove();

        const indicator = document.createElement('div');
        indicator.id = 'eas-monitor-status';

        const isAllSoldOut = availableCount === 0;
        const bgColor = isAllSoldOut ? '#dc3545' : '#28a745';
        const statusText = isAllSoldOut
            ? `❌ ${totalSessions}/${totalSessions} Esaurito`
            : `✅ ${availableCount} disponibile/i`;

        const nextRefresh = CONFIG.REFRESH_INTERVAL_SEC;

        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999998;
            background: ${bgColor};
            color: white;
            padding: 10px 16px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            font-size: 13px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            cursor: pointer;
            user-select: none;
        `;

        indicator.innerHTML = `
            <div style="font-weight:bold;">EAS Monitor Attivo</div>
            <div>${statusText}</div>
            <div id="eas-countdown" style="font-size:11px;opacity:0.8;">Prossimo check: ${nextRefresh}s</div>
        `;

        indicator.title = 'Click per forzare un refresh';
        indicator.addEventListener('click', () => {
            clearTimeout(refreshTimer);
            location.reload();
        });

        document.body.appendChild(indicator);

        // Countdown timer
        let remaining = nextRefresh;
        setInterval(() => {
            remaining--;
            const el = document.getElementById('eas-countdown');
            if (el && remaining >= 0) {
                el.textContent = `Prossimo check: ${remaining}s`;
            }
        }, 1000);
    }

    // ── LOGICA PRINCIPALE ────────────────────────────────────────────

    function runCheck() {
        console.log('[EAS Monitor] Scanning sessioni...');

        const sessions = parseAllSessions();
        const available = findAvailable(sessions);

        console.log(`[EAS Monitor] Totale: ${sessions.length} | Disponibili: ${available.length}`);

        if (available.length > 0) {
            console.log('[EAS Monitor] 🎯 POSTO/I DISPONIBILE/I:');
            available.forEach((s) => console.log(`  → ${s.description} | ${s.note}`));

            // STOP auto-refresh — l'utente deve agire
            clearTimeout(refreshTimer);
            refreshTimer = null;

            // Notifiche
            showBanner(available);
            playBeepSequence();
            flashTab();

            // Status
            showStatusIndicator(sessions.length, available.length);
        } else {
            console.log('[EAS Monitor] Nessun posto disponibile. Prossimo check tra ' + CONFIG.REFRESH_INTERVAL_SEC + 's');

            // Status indicator
            showStatusIndicator(sessions.length, 0);

            // Programma prossimo refresh
            refreshTimer = setTimeout(() => {
                location.reload();
            }, CONFIG.REFRESH_INTERVAL_SEC * 1000);
        }
    }

    // ── AVVIO ────────────────────────────────────────────────────────

    // Attendi che la pagina sia completamente caricata
    if (document.readyState === 'complete') {
        runCheck();
    } else {
        window.addEventListener('load', runCheck);
    }

    console.log('[EAS Monitor] Script caricato. Intervallo: ' + CONFIG.REFRESH_INTERVAL_SEC + 's');

})();
