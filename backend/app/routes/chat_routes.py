"""Chatbot endpoint backed by OpenAI, with RDS-backed tool calling.

A single POST /api/chat that forwards the signed-in user's message to an OpenAI
chat model via the Chat Completions API (OpenAI Python SDK v3+). The model is
given function tools (get_profile / get_accounts / get_transactions) that read
the authenticated customer's own rows from RDS, so the assistant can answer
questions like "what's my checking balance?" or "show my recent transactions".

Security: tool execution ALWAYS scopes queries to flask.g.user_id (set by
@require_auth). Any account identifiers the model passes are only used to
filter within that user's own data — the model can never reach another
customer's rows.

The OpenAI calls (including the tool-call loop) are auto-instrumented by
ddtrace's OpenAI integration (patched by ddtrace-run) and captured by LLM
Observability once LLMObs is enabled in-code (see app/llmobs_setup.py).
"""

import json
import logging
import os

from ddtrace.llmobs import LLMObs
from ddtrace.llmobs.decorators import tool, workflow
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..db import get_session
from ..models import Account, Transaction, User

logger = logging.getLogger("pay2play")

chat_bp = Blueprint("chat", __name__)

_SYSTEM_PROMPT = (
    "You are DCash's friendly banking assistant for the currently signed-in "
    "customer. You can call tools to look up THIS customer's profile, accounts, "
    "and transactions, and should do so whenever a question depends on their "
    "account data. "
    "Customers can also attach an image (e.g. a receipt, a screenshot, or a QR "
    "code) or a voice note along with — or instead of — text. When media is "
    "attached, use it: read and describe what's in an image, and treat a voice "
    "note as the customer's spoken question (interpret what they said, then "
    "answer). Relate the attachment back to their banking when it's relevant. "
    "Answer concisely. Format money as USD. Never ask for or reveal full card "
    "numbers, passwords, or one-time codes, and never discuss any other "
    "customer's data."
)

# Cap the number of tool-call rounds so a misbehaving model can't loop forever.
_MAX_TOOL_ROUNDS = 4

# Multimodal: LLM Obs renders these image types; keep a single inline image under
# the 4 MiB per-part cap (base64 is ~4/3 the binary size) so it isn't dropped.
_SUPPORTED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_MAX_IMAGE_B64_CHARS = 5_000_000  # ~3.75 MB binary

# Audio: OpenAI Chat Completions `input_audio` parts only accept wav or mp3, so
# map incoming mime types to the format string the API expects. The frontend
# normalizes recordings/uploads to 16kHz mono WAV before sending.
_AUDIO_MIME_TO_FORMAT = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
}
_MAX_AUDIO_B64_CHARS = 8_000_000  # ~6 MB binary (~60s of 16kHz mono WAV)


def _parse_image(raw):
    """Parse a `data:<mime>;base64,<data>` URL into {mime, b64}, or return an error."""
    if not raw or not isinstance(raw, str) or not raw.startswith("data:"):
        return None, None
    try:
        header, b64 = raw.split(",", 1)
    except ValueError:
        return None, "invalid image data"
    mime = header[5:].split(";", 1)[0].strip().lower()
    if mime not in _SUPPORTED_IMAGE_MIMES:
        return None, f"unsupported image type '{mime}' (use PNG, JPEG, WEBP, or GIF)"
    if len(b64) > _MAX_IMAGE_B64_CHARS:
        return None, "image too large (max ~3.5MB)"
    return {"mime": mime, "b64": b64}, None


def _parse_audio(raw):
    """Parse a `data:<mime>;base64,<data>` audio URL into {mime, b64, format}, or an error."""
    if not raw or not isinstance(raw, str) or not raw.startswith("data:"):
        return None, None
    try:
        header, b64 = raw.split(",", 1)
    except ValueError:
        return None, "invalid audio data"
    mime = header[5:].split(";", 1)[0].strip().lower()
    fmt = _AUDIO_MIME_TO_FORMAT.get(mime)
    if fmt is None:
        return None, f"unsupported audio type '{mime}' (use WAV or MP3)"
    if len(b64) > _MAX_AUDIO_B64_CHARS:
        return None, "audio too large (max ~6MB)"
    return {"mime": mime, "b64": b64, "format": fmt}, None

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_profile",
            "description": "Get the signed-in customer's profile (name, email, member-since date).",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_accounts",
            "description": "List the signed-in customer's bank accounts with type, last 4 digits, and current balance.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_transactions",
            "description": "List the signed-in customer's most recent transactions, optionally filtered to one account by its last 4 digits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_last4": {
                        "type": "string",
                        "description": "Optional: last 4 digits of the account to filter by.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max transactions to return (default 10, max 50).",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
]

_client = None


def _is_reasoning_model(model: str) -> bool:
    """True for OpenAI reasoning models (gpt-5 family and o-series).

    Chat-optimized variants (``*-chat*`` / ``chat-latest``) are NOT reasoning
    models and reject ``reasoning_effort``, so exclude anything with "chat".
    """
    m = (model or "").lower()
    if "chat" in m:
        return False
    return m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")


def _client_or_none():
    """Lazily build the OpenAI client (reads OPENAI_API_KEY from env)."""
    global _client
    if _client is None and os.getenv("OPENAI_API_KEY"):
        from openai import OpenAI

        _client = OpenAI()
    return _client


# --- Tool implementations (always scoped to the authenticated user) ---
#
# Each is decorated with @tool so it shows up as a "tool" span in LLM
# Observability (auto-instrumentation only covers the OpenAI call itself, not
# our internal DB functions). They open their own session so the captured span
# input is just the meaningful arguments.

@tool(name="get_profile")
def _tool_get_profile(user_id: int) -> dict:
    session = get_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            return {"error": "user not found"}
        return {
            "firstName": user.first_name,
            "lastName": user.last_name,
            "email": user.email,
            "memberSince": user.created_at.isoformat() if user.created_at else None,
        }
    finally:
        session.close()


@tool(name="get_accounts")
def _tool_get_accounts(user_id: int) -> list:
    session = get_session()
    try:
        accounts = session.query(Account).filter(Account.user_id == user_id).all()
        return [
            {
                "type": a.account_type,
                "last4": a.account_number[-4:],
                "balance": float(a.balance),
            }
            for a in accounts
        ]
    finally:
        session.close()


@tool(name="get_transactions")
def _tool_get_transactions(user_id: int, account_last4=None, limit=10) -> list:
    try:
        limit = max(1, min(int(limit or 10), 50))
    except (TypeError, ValueError):
        limit = 10

    session = get_session()
    try:
        q = (
            session.query(Transaction)
            .join(Account, Transaction.account_id == Account.id)
            .filter(Account.user_id == user_id)
        )
        if account_last4:
            q = q.filter(Account.account_number.like(f"%{str(account_last4)[-4:]}"))
        txs = q.order_by(Transaction.created_at.desc()).limit(limit).all()
        return [
            {
                "date": t.created_at.isoformat() if t.created_at else None,
                "kind": t.kind,
                "amount": float(t.amount),
                "description": t.description,
                "balanceAfter": float(t.balance_after),
                "accountLast4": t.account.account_number[-4:],
            }
            for t in txs
        ]
    finally:
        session.close()


def _dispatch_tool(user_id: int, name: str, args: dict):
    if name == "get_profile":
        return _tool_get_profile(user_id)
    if name == "get_accounts":
        return _tool_get_accounts(user_id)
    if name == "get_transactions":
        return _tool_get_transactions(
            user_id,
            account_last4=args.get("account_last4"),
            limit=args.get("limit", 10),
        )
    return {"error": f"unknown tool {name}"}


@workflow(name="banking_assistant")
def _run_chat(user_id: int, message: str, image: dict | None = None, audio: dict | None = None) -> str:
    """Run the tool-calling loop as a single LLM Observability workflow span.

    The OpenAI chat.completions calls (auto-instrumented) and the @tool spans
    nest under this workflow span, so the whole request is one coherent trace.
    When an image or audio clip is attached it's sent inline (base64) so the
    OpenAI integration captures it multimodally (ddtrace >= 4.15). Audio input
    requires an audio-capable model (e.g. gpt-4o-mini-audio-preview) and only
    accepts wav/mp3, so we swap the model + request text-only output for it.
    """
    client = _client_or_none()
    # Multimodal user turn: content becomes a list of parts when media is present.
    if image or audio:
        parts = [{"type": "text", "text": message or ("What's in this recording?" if audio else "What's in this image?")}]
        if image:
            parts.append({"type": "image_url", "image_url": {"url": f"data:{image['mime']};base64,{image['b64']}"}})
        if audio:
            parts.append({"type": "input_audio", "input_audio": {"data": audio["b64"], "format": audio["format"]}})
        user_content = parts
    else:
        user_content = message

    # Audio input needs an audio-capable model; otherwise use the default text model.
    if audio:
        model = os.getenv("OPENAI_AUDIO_MODEL", "gpt-audio-mini")
    else:
        model = os.getenv("OPENAI_MODEL", "gpt-5-mini")

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    def _create():
        kwargs = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": 800,
            "tools": _TOOLS,
        }
        if audio:
            # Audio models can emit audio too; we only want a text reply.
            kwargs["modalities"] = ["text"]
        if _is_reasoning_model(model):
            kwargs["reasoning_effort"] = "minimal"
        return client.chat.completions.create(**kwargs)

    reply = ""
    for _ in range(_MAX_TOOL_ROUNDS):
        resp = _create()
        choice = resp.choices[0] if resp.choices else None
        msg = choice.message if choice else None
        tool_calls = getattr(msg, "tool_calls", None) if msg else None

        if not tool_calls:
            reply = ((msg.content if msg else "") or "").strip()
            break

        # Record the assistant turn that requested the tool(s).
        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )
        # Execute each requested tool against RDS (scoped to this user).
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _dispatch_tool(user_id, tc.function.name, args)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, default=str),
                }
            )

    # Annotate the workflow span with clean top-level input/output. Attach media
    # via the typed `image_parts` / `audio_parts` fields (best practice) so they
    # render on the span alongside the transcript.
    input_msg = {"role": "user", "content": message or ("(audio)" if audio else "(image)")}
    if image:
        input_msg["image_parts"] = [{"mime_type": image["mime"], "content": image["b64"]}]
    if audio:
        input_msg["audio_parts"] = [{"mime_type": audio["mime"], "content": audio["b64"]}]
    LLMObs.annotate(input_data=[input_msg], output_data=reply)
    return reply


@chat_bp.post("/api/chat")
@require_auth
def chat():
    client = _client_or_none()
    if client is None:
        return jsonify({"error": "chat is not configured (missing OPENAI_API_KEY)"}), 503

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    image, img_err = _parse_image(data.get("image"))
    if img_err:
        return jsonify({"error": img_err}), 400
    audio, aud_err = _parse_audio(data.get("audio"))
    if aud_err:
        return jsonify({"error": aud_err}), 400
    if not message and not image and not audio:
        return jsonify({"error": "message, image, or audio is required"}), 400

    try:
        reply = _run_chat(g.user_id, message, image=image, audio=audio)
    except Exception as exc:
        # AI Guard blocks surface as OpenAIAIGuardAbortError (subclass of both
        # openai.UnprocessableEntityError and ddtrace's AIGuardAbortError).
        name = type(exc).__name__
        if "AIGuard" in name or "Unprocessable" in name:
            reason = getattr(exc, "reason", None) or "policy violation"
            logger.warning("chat: AI Guard blocked the request (%s)", reason)
            return jsonify({"reply": f"⚠️ Blocked by AI Guard ({reason}).", "blocked": True}), 200
        logger.exception("chat completion failed")
        return jsonify({"error": "chat backend error"}), 502

    if not reply:
        logger.warning("chat: empty reply after %d tool round(s)", _MAX_TOOL_ROUNDS)
        reply = "Sorry, I couldn't generate a response just now. Please try again."
    return jsonify({"reply": reply})
