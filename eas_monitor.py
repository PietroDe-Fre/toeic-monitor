#!/usr/bin/env python3
"""
EAS Milan TOEIC Exam Availability Monitor
==========================================
Monitors the EAS Milan TOEIC Remote exam page for available (non-Esaurito)
exam slots and sends notifications via desktop toast, email, and/or sound.

Usage:
    python eas_monitor.py              # Start continuous monitoring
    python eas_monitor.py --dry-run    # Single check, print status, no notifications
    python eas_monitor.py --test-email # Send a test email notification
    python eas_monitor.py --test-mock  # Test with a mock available entry
"""

import argparse
import configparser
import html
import logging
import os
import re
import smtplib
import sys
import time
import winsound
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR / "config.ini"

def load_config() -> configparser.ConfigParser:
    """Load configuration from config.ini."""
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_FILE, encoding="utf-8")
    return cfg


# ---------------------------------------------------------------------------
# LOGGING
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    """Configure dual logging: console + file."""
    logger = logging.getLogger("eas_monitor")
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-7s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # File handler
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger


# ---------------------------------------------------------------------------
# HTML PARSING
# ---------------------------------------------------------------------------

class ExamSession:
    """Represents a single exam session row."""

    def __init__(self, description: str, note: str, has_buy_link: bool,
                 buy_url: str | None, price_student: str, price_public: str):
        self.description = description.strip()
        self.note = note.strip()
        self.has_buy_link = has_buy_link
        self.buy_url = buy_url
        self.price_student = price_student.strip()
        self.price_public = price_public.strip()

    @property
    def is_sold_out(self) -> bool:
        return "esaurito" in self.note.lower()

    @property
    def is_available(self) -> bool:
        """An entry is available if it's NOT sold out OR has a buy link."""
        return not self.is_sold_out or self.has_buy_link

    @property
    def has_last_spots(self) -> bool:
        """Check for 'ultimi N posti' pattern."""
        return bool(re.search(r"ultim\w*\s+\d+\s+post", self.note, re.IGNORECASE))

    @property
    def unique_key(self) -> str:
        """Unique identifier for deduplication."""
        return self.description

    def __repr__(self) -> str:
        status = "AVAILABLE" if self.is_available else "ESAURITO"
        extra = f" [{self.note}]" if self.note and not self.is_sold_out else ""
        return f"[{status}] {self.description}{extra}"


def fetch_page(url: str, timeout: int = 30) -> str:
    """Fetch the EAS page HTML."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def parse_sessions(html_content: str) -> list[ExamSession]:
    """Parse all exam sessions from the HTML."""
    soup = BeautifulSoup(html_content, "html.parser")
    sessions: list[ExamSession] = []

    for row in soup.select("div.riga_tabella"):
        # Description (date, time, location)
        desc_div = row.select_one("div.tabelladescrizione")
        description = desc_div.get_text(strip=True) if desc_div else "N/A"

        # Note (Esaurito / ultimi N posti / empty)
        note_div = row.select_one("div.tabellanote")
        note = note_div.get_text(strip=True) if note_div else ""

        # Buy button
        buy_div = row.select_one("div.tabellaacquista")
        buy_link = buy_div.select_one("a") if buy_div else None
        has_buy = buy_link is not None
        buy_url = buy_link.get("href") if buy_link else None

        # Prices
        price_pub_div = row.select_one("div.tabellaprezzo.pubblico")
        price_stu_div = row.select_one("div.tabellaprezzo.studenti")
        price_pub = price_pub_div.get_text(strip=True) if price_pub_div else ""
        price_stu = price_stu_div.get_text(strip=True) if price_stu_div else ""

        sessions.append(ExamSession(
            description=description,
            note=note,
            has_buy_link=has_buy,
            buy_url=buy_url,
            price_student=price_stu,
            price_public=price_pub,
        ))

    return sessions


def find_available(sessions: list[ExamSession]) -> list[ExamSession]:
    """Return only sessions that are NOT sold out."""
    return [s for s in sessions if s.is_available]


# ---------------------------------------------------------------------------
# NOTIFICATIONS
# ---------------------------------------------------------------------------

def notify_desktop(title: str, message: str, logger: logging.Logger) -> None:
    """Send a Windows desktop toast notification."""
    try:
        from plyer import notification
        notification.notify(
            title=title,
            message=message[:256],  # Windows limits toast body
            app_name="EAS Monitor",
            timeout=30,
        )
        logger.info("Desktop notification sent.")
    except Exception as e:
        logger.error(f"Desktop notification failed: {e}")


def notify_sound(logger: logging.Logger) -> None:
    """Play an attention-grabbing beep sequence."""
    try:
        for freq, dur in [(1000, 300), (1500, 300), (2000, 300), (1500, 300), (1000, 500)]:
            winsound.Beep(freq, dur)
        logger.info("Sound alert played.")
    except Exception as e:
        logger.error(f"Sound alert failed: {e}")


def notify_email(subject: str, body_html: str, cfg: configparser.ConfigParser,
                 logger: logging.Logger) -> None:
    """Send an email notification via SMTP."""
    try:
        smtp_host = cfg.get("email", "smtp_host")
        smtp_port = cfg.getint("email", "smtp_port")
        smtp_user = cfg.get("email", "smtp_user")
        smtp_pass = cfg.get("email", "smtp_password")
        recipient = cfg.get("email", "recipient")
        sender_name = cfg.get("email", "sender_name", fallback="EAS Monitor")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{sender_name} <{smtp_user}>"
        msg["To"] = recipient

        # Plain text version
        plain_text = BeautifulSoup(body_html, "html.parser").get_text()
        msg.attach(MIMEText(plain_text, "plain", "utf-8"))
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, [recipient], msg.as_string())

        logger.info(f"Email notification sent to {recipient}.")
    except Exception as e:
        logger.error(f"Email notification failed: {e}")


def build_email_body(available: list[ExamSession], url: str) -> str:
    """Build an HTML email body listing available exam sessions."""
    rows = ""
    for s in available:
        note_badge = ""
        if s.has_last_spots:
            note_badge = f' <span style="color:#e67e22;font-weight:bold;">⚠ {s.note}</span>'
        buy_btn = ""
        if s.buy_url:
            buy_btn = f' <a href="{html.escape(s.buy_url)}" style="background:#28a745;color:white;padding:4px 12px;border-radius:4px;text-decoration:none;">Acquista</a>'

        rows += f"""
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee;">{html.escape(s.description)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;">{html.escape(s.price_student)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;">{note_badge}{buy_btn}</td>
        </tr>"""

    return f"""
    <html>
    <body style="font-family:Arial,sans-serif;">
        <h2 style="color:#28a745;">🎯 EAS TOEIC – Posti Disponibili!</h2>
        <p>Sono stati trovati <strong>{len(available)}</strong> slot d'esame disponibili:</p>
        <table style="border-collapse:collapse;width:100%;">
            <tr style="background:#f8f9fa;">
                <th style="padding:8px;text-align:left;">Sessione</th>
                <th style="padding:8px;text-align:left;">Prezzo Studenti</th>
                <th style="padding:8px;text-align:left;">Stato</th>
            </tr>
            {rows}
        </table>
        <p style="margin-top:20px;">
            <a href="{html.escape(url)}" style="background:#007bff;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:16px;">
                🔗 Vai alla pagina EAS
            </a>
        </p>
        <p style="color:#888;font-size:12px;margin-top:30px;">
            Notifica generata il {datetime.now().strftime('%d/%m/%Y alle %H:%M:%S')}
        </p>
    </body>
    </html>
    """


# ---------------------------------------------------------------------------
# MAIN MONITOR LOOP
# ---------------------------------------------------------------------------

def send_notifications(available: list[ExamSession], cfg: configparser.ConfigParser,
                       url: str, logger: logging.Logger) -> None:
    """Dispatch notifications across all enabled channels."""
    summary = "\n".join(str(s) for s in available)
    title = f"🎯 EAS TOEIC: {len(available)} posto/i disponibile/i!"
    short_msg = available[0].description if available else "Slot disponibile!"

    # Desktop toast
    if cfg.getboolean("notifications", "desktop_enabled", fallback=True):
        notify_desktop(title, short_msg, logger)

    # Sound
    if cfg.getboolean("notifications", "sound_enabled", fallback=True):
        notify_sound(logger)

    # Email
    if cfg.getboolean("notifications", "email_enabled", fallback=False):
        body = build_email_body(available, url)
        notify_email(title, body, cfg, logger)


def monitor_loop(cfg: configparser.ConfigParser, logger: logging.Logger) -> None:
    """Main monitoring loop with deduplication."""
    url = cfg.get("monitor", "url")
    interval = cfg.getint("monitor", "poll_interval", fallback=60)
    notified_keys: set[str] = set()

    logger.info("=" * 60)
    logger.info("EAS Milan TOEIC Exam Availability Monitor")
    logger.info(f"URL:      {url}")
    logger.info(f"Interval: {interval}s")
    logger.info("=" * 60)

    check_count = 0
    while True:
        check_count += 1
        try:
            logger.info(f"--- Check #{check_count} ---")
            html_content = fetch_page(url)
            sessions = parse_sessions(html_content)
            logger.info(f"Parsed {len(sessions)} sessions.")

            available = find_available(sessions)
            # Filter out already-notified
            new_available = [s for s in available if s.unique_key not in notified_keys]

            if new_available:
                logger.info(f"🎯 FOUND {len(new_available)} NEW AVAILABLE SESSION(S)!")
                for s in new_available:
                    logger.info(f"  → {s}")
                    notified_keys.add(s.unique_key)

                send_notifications(new_available, cfg, url, logger)
            else:
                sold_out = len(sessions) - len(available)
                logger.info(f"No new available slots. ({sold_out}/{len(sessions)} esaurito)")

        except requests.RequestException as e:
            logger.warning(f"Network error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}", exc_info=True)

        logger.debug(f"Next check in {interval}s...")
        time.sleep(interval)


# ---------------------------------------------------------------------------
# CLI COMMANDS
# ---------------------------------------------------------------------------

def cmd_dry_run(cfg: configparser.ConfigParser, logger: logging.Logger) -> None:
    """Fetch once, print all sessions, no notifications."""
    url = cfg.get("monitor", "url")
    logger.info(f"DRY RUN — fetching {url}")

    html_content = fetch_page(url)
    sessions = parse_sessions(html_content)

    logger.info(f"\nTotal sessions: {len(sessions)}")
    logger.info("-" * 50)

    available_count = 0
    for i, s in enumerate(sessions, 1):
        status = "✅ AVAILABLE" if s.is_available else "❌ Esaurito"
        extra = ""
        if s.has_last_spots:
            extra = f" ⚠ {s.note}"
        if s.buy_url:
            extra += f" 🛒 {s.buy_url}"
        logger.info(f"  {i:3d}. [{status}] {s.description} | {s.price_student}{extra}")
        if s.is_available:
            available_count += 1

    logger.info("-" * 50)
    logger.info(f"Available: {available_count} | Esaurito: {len(sessions) - available_count}")


def cmd_test_email(cfg: configparser.ConfigParser, logger: logging.Logger) -> None:
    """Send a test email with a mock available session."""
    mock = ExamSession(
        description="[TEST] Venerdì 14 ore 10:00 - Sessione Remota",
        note="ultimi 3 posti",
        has_buy_link=True,
        buy_url="https://eas-milan.org/index.php?f=carrello.php&id=999",
        price_student="€ 130,00",
        price_public="€ 145,00",
    )
    url = cfg.get("monitor", "url")
    body = build_email_body([mock], url)
    notify_email("🧪 [TEST] EAS Monitor — Notifica di prova", body, cfg, logger)


def cmd_test_mock(cfg: configparser.ConfigParser, logger: logging.Logger) -> None:
    """Test detection with a local mock HTML containing an available slot."""
    mock_html = """
    <div class="riga_tabella Marzo" data-citta="Sessione Remota" data-mese="3">
        <div class="tabelladescrizione">
            <strong>Lunedì 10 ore 10:00</strong>
            - Sessione Remota - <b><font color="#28874A">Versione: Remoto da Casa</font></b>
        </div>
        <div class="tabellaprezzo pubblico">€ 145,00</div>
        <div class="tabellaprezzo studenti">€ 130,00</div>
        <div class="tabellanote">ultimi 2 posti</div>
        <div class="tabellaacquista">
            <a href="index.php?f=carrello.php&id=999">Acquista</a>
        </div>
    </div>
    <div class="riga_tabella Marzo" data-citta="Sessione Remota" data-mese="3">
        <div class="tabelladescrizione">
            <strong>Lunedì 10 ore 15:00</strong>
            - Sessione Remota
        </div>
        <div class="tabellaprezzo pubblico">€ 145,00</div>
        <div class="tabellaprezzo studenti">€ 130,00</div>
        <div class="tabellanote">Esaurito&nbsp;</div>
        <div class="tabellaacquista"></div>
    </div>
    """

    sessions = parse_sessions(mock_html)
    available = find_available(sessions)

    logger.info(f"Mock test: {len(sessions)} sessions parsed, {len(available)} available.")
    for s in sessions:
        logger.info(f"  → {s}")

    if available:
        logger.info("✅ Detection works! Sending desktop + sound notification...")
        if cfg.getboolean("notifications", "desktop_enabled", fallback=True):
            notify_desktop("🧪 [TEST] EAS Monitor", available[0].description, logger)
        if cfg.getboolean("notifications", "sound_enabled", fallback=True):
            notify_sound(logger)
    else:
        logger.error("❌ Detection failed — no available sessions found in mock data!")


# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="EAS Milan TOEIC Exam Availability Monitor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Single check, print status, no notifications")
    parser.add_argument("--test-email", action="store_true",
                        help="Send a test email notification")
    parser.add_argument("--test-mock", action="store_true",
                        help="Test detection with mock available entry")
    args = parser.parse_args()

    cfg = load_config()
    log_file = cfg.get("monitor", "log_file", fallback="eas_monitor.log")
    log_path = SCRIPT_DIR / log_file
    logger = setup_logging(str(log_path))

    try:
        if args.dry_run:
            cmd_dry_run(cfg, logger)
        elif args.test_email:
            cmd_test_email(cfg, logger)
        elif args.test_mock:
            cmd_test_mock(cfg, logger)
        else:
            monitor_loop(cfg, logger)
    except KeyboardInterrupt:
        logger.info("\nMonitor stopped by user (Ctrl+C).")
        sys.exit(0)


if __name__ == "__main__":
    main()
