"""Plynth mail bridge.

A tiny Flask HTTP wrapper that lets the Plynth Supabase Edge Functions reuse the
existing ngrok-remote-manager mailer (Gmail primary + Gmail backup + offline
queue) WITHOUT modifying that project.

- Imports lib.mailer.Mailer / lib.config.load_all read-only.
- Uses a SEPARATE state directory so the existing daemon's offline queue is
  untouched.
- Listens on 127.0.0.1:5556 (different from any port the existing daemon uses).
- Bearer-token auth on every request.
- Exposed publicly via a separate Cloudflare Tunnel (see cloudflared/).

Run as a systemd unit; never edit ngrok-remote-manager.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import threading
from pathlib import Path

from flask import Flask, jsonify, request

# --- Wire in the existing mailer without modifying it ----------------------
NGROK_PROJECT = os.environ.get("NGROK_PROJECT_PATH", "/home/vijay/ngrok-remote-manager")
sys.path.insert(0, NGROK_PROJECT)

from lib.config import load_all  # noqa: E402
from lib.mailer import Mailer     # noqa: E402

# Use a dedicated state dir so we don't share the queue file with the daemon.
STATE_DIR = Path(os.environ.get("PLYNTH_BRIDGE_STATE_DIR", "/home/vijay/plynth/mail-bridge/state"))
STATE_DIR.mkdir(parents=True, exist_ok=True)

# Build a config dict, ensure absolute paths point to our state dir for queueing.
_cfg = load_all()
# Mailer in lib/mailer.py uses a module-level state path; we monkey-patch it
# at runtime ONLY inside this process to redirect the queue file.
import lib.mailer as _ngrok_mailer  # noqa: E402
if hasattr(_ngrok_mailer, "QUEUE_FILE"):
    _ngrok_mailer.QUEUE_FILE = str(STATE_DIR / "email_queue.jsonl")

mailer = Mailer(_cfg)
NOTIFY_DEFAULT = _cfg.get("NOTIFY_EMAIL", "vijay.devops.bot@gmail.com")

BRIDGE_TOKEN = os.environ.get("PLYNTH_BRIDGE_TOKEN", "").strip()
if not BRIDGE_TOKEN:
    print("[plynth-bridge] WARNING: PLYNTH_BRIDGE_TOKEN not set — bridge will refuse all requests")

START_TS = time.time()
log = logging.getLogger("plynth-bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# --- Background flush thread -----------------------------------------------
def _flush_loop() -> None:
    while True:
        try:
            mailer.flush_queue()
            mailer.check_primary_recovery()
        except Exception as e:
            log.warning("flush loop error: %s", e)
        time.sleep(60)

threading.Thread(target=_flush_loop, daemon=True).start()

# --- HTTP API --------------------------------------------------------------
app = Flask(__name__)


def _check_auth() -> bool:
    if not BRIDGE_TOKEN:
        return False
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {BRIDGE_TOKEN}"


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "primary_up": not getattr(mailer, "using_backup", False),
        "queue_size": getattr(mailer, "queue_size", 0),
        "uptime_s": int(time.time() - START_TS),
    })


@app.route("/api/mail/send", methods=["POST"])
def send_mail():
    if not _check_auth():
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    subject = (data.get("subject") or "").strip()
    body = data.get("body") or ""
    body_type = data.get("body_type", "plain")
    urgent = bool(data.get("urgent", False))
    to = (data.get("to") or NOTIFY_DEFAULT).strip()

    if not subject or not body:
        return jsonify({"error": "subject and body required"}), 400

    # The existing Mailer.send() sends to NOTIFY_EMAIL by default. Override
    # the recipient just for this call by temporarily swapping the config.
    original_to = _cfg.get("NOTIFY_EMAIL")
    try:
        _cfg["NOTIFY_EMAIL"] = to
        ok = mailer.send(subject=subject, body=body, body_type=body_type, urgent=urgent)
    finally:
        _cfg["NOTIFY_EMAIL"] = original_to
    return jsonify({
        "success": bool(ok),
        "using_backup": getattr(mailer, "using_backup", False),
        "queue_size": getattr(mailer, "queue_size", 0),
    }), (200 if ok else 502)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5556")), debug=False)
