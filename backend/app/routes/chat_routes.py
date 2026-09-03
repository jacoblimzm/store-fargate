"""Chatbot endpoint backed by OpenAI.

Deliberately minimal: a single POST /api/chat that forwards the user's message
to an OpenAI model via the modern Responses API (OpenAI Python SDK v3+). The
call is auto-instrumented by ddtrace's OpenAI integration (patched by
ddtrace-run) and captured by LLM Observability once LLMObs is enabled in-code
(see app/llmobs_setup.py). This is our end-to-end validation of
"ddtrace-run + in-code LLMObs.enable()".
"""

import logging
import os

from flask import Blueprint, jsonify, request

logger = logging.getLogger("pay2play")

chat_bp = Blueprint("chat", __name__)

_SYSTEM_PROMPT = (
    "You are Pay2Play's friendly banking assistant. Answer concisely and "
    "helpfully. Never ask for full card numbers, passwords, or one-time codes."
)

_client = None


def _client_or_none():
    """Lazily build the OpenAI client (reads OPENAI_API_KEY from env)."""
    global _client
    if _client is None and os.getenv("OPENAI_API_KEY"):
        from openai import OpenAI

        _client = OpenAI()
    return _client


@chat_bp.post("/api/chat")
def chat():
    client = _client_or_none()
    if client is None:
        return jsonify({"error": "chat is not configured (missing OPENAI_API_KEY)"}), 503

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    try:
        resp = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5"),
            instructions=_SYSTEM_PROMPT,
            input=message,
            max_output_tokens=300,
        )
    except Exception:
        logger.exception("chat completion failed")
        return jsonify({"error": "chat backend error"}), 502

    reply = (resp.output_text or "").strip()
    return jsonify({"reply": reply})
