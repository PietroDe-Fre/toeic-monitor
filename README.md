# EAS Milan TOEIC — Monitor Disponibilità Esami

Script di monitoraggio automatico per la pagina [EAS Milan TOEIC® Listening and Reading (Da Remoto)](https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2).

Rileva in automatico quando un posto d'esame diventa **disponibile** (non più "Esaurito") e invia notifiche immediate.

---

## 📁 Struttura del Progetto

```
eas-monitor/
├── eas_monitor.py          # Script Python principale
├── eas_monitor.user.js     # Userscript per Tampermonkey (browser)
├── config.ini              # Configurazione (email, intervalli, ecc.)
├── requirements.txt        # Dipendenze Python
└── README.md               # Questa documentazione
```

---

## 🐍 Metodo 1: Script Python (Monitoraggio da Terminale)

### Prerequisiti

- **Python 3.10+** (verifica: `python --version`)
- **pip** (incluso con Python)

### Installazione

1. **Apri un terminale** (PowerShell o cmd) e spostati nella cartella del progetto:

   ```powershell
   cd C:\Users\pdefr\.gemini\antigravity\scratch\eas-monitor
   ```

2. **(Opzionale) Crea un ambiente virtuale:**

   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

3. **Installa le dipendenze:**

   ```powershell
   pip install -r requirements.txt
   ```

### Configurazione

Modifica il file **`config.ini`** con un editor di testo:

```ini
[monitor]
url = https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2
poll_interval = 60           # Secondi tra ogni controllo

[notifications]
desktop_enabled = true       # Notifica desktop Windows
email_enabled = false        # Notifica email (richiede configurazione SMTP)
sound_enabled = true         # Beep sonoro

[email]
smtp_host = smtp.gmail.com
smtp_port = 587
smtp_user = tuo_indirizzo@gmail.com
smtp_password = la_tua_app_password
recipient = destinatario@email.com
```

#### Configurazione Email (Gmail)

Per usare le notifiche email con Gmail:

1. Vai su [myaccount.google.com](https://myaccount.google.com)
2. **Sicurezza** → **Verifica in due passaggi** (deve essere attiva)
3. **Sicurezza** → **Password per le app** → Genera una password per "Posta"
4. Copia la password di 16 caratteri in `smtp_password`
5. Imposta `email_enabled = true`

### Utilizzo

#### Monitoraggio Continuo
```powershell
python eas_monitor.py
```
Lo script controlla la pagina ogni 60 secondi (configurabile). Quando trova un posto disponibile:
- 🔔 Mostra una notifica desktop Windows
- 🔊 Emette un segnale acustico
- 📧 Invia un'email (se configurata)

**Ferma lo script** con `Ctrl+C`.

#### Controllo Singolo (Dry Run)
```powershell
python eas_monitor.py --dry-run
```
Esegue un singolo controllo, stampa lo stato di tutte le sessioni e termina. Non invia notifiche.

#### Test Notifica Email
```powershell
python eas_monitor.py --test-email
```
Invia un'email di prova per verificare che la configurazione SMTP sia corretta.

#### Test con Dati Mock
```powershell
python eas_monitor.py --test-mock
```
Simula il rilevamento di un posto disponibile. Utile per testare le notifiche desktop e sonore.

### Log

Lo script scrive un log dettagliato su:
- **Console** (stdout)
- **File** `eas_monitor.log` (nella cartella del progetto)

---

## 🌐 Metodo 2: Userscript Tampermonkey (Monitoraggio da Browser)

### Prerequisiti

- **Browser**: Chrome, Firefox, Edge o Opera
- **Estensione Tampermonkey** installata

### Installazione di Tampermonkey

1. Vai allo store estensioni del tuo browser:
   - **Chrome**: [Tampermonkey su Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - **Firefox**: [Tampermonkey su Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - **Edge**: [Tampermonkey su Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. Clicca **"Aggiungi"** / **"Installa"**

### Installazione dello Userscript

#### Metodo A: Installazione da File Locale

1. **Clicca sull'icona di Tampermonkey** nella barra del browser (icona scura quadrata)
2. Seleziona **"Crea un nuovo script..."** (o "Create a new script...")
3. **Cancella tutto** il contenuto predefinito nell'editor
4. **Apri** il file `eas_monitor.user.js` con un editor di testo (es. Notepad, VS Code)
5. **Copia tutto** il contenuto (`Ctrl+A` → `Ctrl+C`)
6. **Incolla** nell'editor di Tampermonkey (`Ctrl+V`)
7. Clicca **"File" → "Salva"** (o `Ctrl+S`)
8. Lo script è ora attivo ✅

#### Metodo B: Installazione tramite URL

1. Clicca sull'icona di Tampermonkey → **"Utilities"** / **"Strumenti"**
2. Nella sezione **"Install from URL"**, incolla il percorso locale del file:
   ```
   file:///C:/Users/pdefr/.gemini/antigravity/scratch/eas-monitor/eas_monitor.user.js
   ```
3. Clicca **"Install"** / **"Installa"**

### Come Funziona

1. **Naviga** su [la pagina TOEIC EAS](https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2)
2. Lo script si attiva **automaticamente**
3. Un **indicatore rosso** in basso a destra mostra lo stato:
   - `❌ 64/64 Esaurito` — tutti i posti esauriti
   - Countdown al prossimo refresh
4. Ogni **90 secondi** la pagina si ricarica automaticamente
5. Se viene trovato un posto disponibile:
   - 🟢 **Banner verde** in cima alla pagina con i dettagli
   - 🔊 **Alert sonoro** (beep nel browser)
   - 📑 **Tab lampeggiante** ("🎯 POSTO DISPONIBILE!")
   - ⏸️ **Auto-refresh disattivato** per permetterti di agire
6. **Click sull'indicatore** rosso per forzare un refresh manuale

### Configurazione

Per modificare l'intervallo o disabilitare le notifiche, modifica le costanti all'inizio del file:

```javascript
const CONFIG = {
    REFRESH_INTERVAL_SEC: 90,   // Intervallo auto-refresh (secondi)
    ENABLE_SOUND: true,         // Alert sonoro
    ENABLE_BANNER: true,        // Banner visivo
    ENABLE_TAB_FLASH: true,     // Flash titolo tab
};
```

### Verifica Funzionamento

1. Apri la pagina EAS nel browser
2. Premi **`F12`** → tab **Console**
3. Dovresti vedere:
   ```
   [EAS Monitor] Script caricato. Intervallo: 90s
   [EAS Monitor] Scanning sessioni...
   [EAS Monitor] Totale: 64 | Disponibili: 0
   [EAS Monitor] Nessun posto disponibile. Prossimo check tra 90s
   ```
4. L'indicatore rosso in basso a destra conferma che il monitor è attivo

---

## ⚡ Quale Metodo Usare?

| Caratteristica | Python Script | Userscript Browser |
|---|---|---|
| **Funziona in background** | ✅ Sì (terminale aperto) | ❌ Solo con tab aperta |
| **Notifiche email** | ✅ Sì | ❌ No |
| **Notifica desktop** | ✅ Toast Windows | ✅ Banner in-page |
| **Alert sonoro** | ✅ Beep di sistema | ✅ Beep Web Audio |
| **Link diretto acquisto** | ❌ Solo nell'email | ✅ Sì, nel banner |
| **Installazione** | Python + pip | Solo estensione browser |
| **Consumo risorse** | Bassissimo | Pagina browser aperta |

**Consiglio**: Usa **entrambi** per massimizzare le possibilità:
- Il **Python script** gira in background nel terminale e ti manda email
- Lo **userscript** ti tiene la pagina aperta e pronta per acquistare al click

---

## 🔧 Troubleshooting

### Python: "ModuleNotFoundError: No module named 'plyer'"
```powershell
pip install plyer
```

### Python: Notifica desktop non appare
Su alcuni sistemi Windows, `plyer` potrebbe non funzionare. Le notifiche sonore e email continueranno a funzionare normalmente.

### Python: Email non inviata
- Verifica che `email_enabled = true` in `config.ini`
- Verifica la **App Password** di Gmail (non la password normale)
- Controlla che la verifica in 2 passaggi sia attiva su Gmail

### Userscript: Non si attiva
- Verifica che Tampermonkey sia **abilitato** (icona colorata, non grigia)
- Verifica che lo script sia **attivo** (Dashboard Tampermonkey → interruttore ON)
- L'URL deve corrispondere esattamente a `https://eas-milan.org/index.php?f=dettaglio.php&id=62&tipo=2`

### Userscript: Nessun suono
- Il browser potrebbe bloccare l'audio fino all'interazione dell'utente. Clicca sulla pagina almeno una volta dopo il caricamento.
