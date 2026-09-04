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
    "You are Pay2Play's friendly banking assistant for the currently signed-in "
    "customer. You can call tools to look up THIS customer's profile, accounts, "
    "and transactions, and should do so whenever a question depends on their "
    "account data. Answer concisely. Format money as USD. Never ask for or "
    "reveal full card numbers, passwords, or one-time codes, and never discuss "
    "any other customer's data."
)

# Cap the number of tool-call rounds so a misbehaving model can't loop forever.
_MAX_TOOL_ROUNDS = 4

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
def _run_chat(user_id: int, message: str) -> str:
    """Run the tool-calling loop as a single LLM Observability workflow span.

    The OpenAI chat.completions calls (auto-instrumented) and the @tool spans
    nest under this workflow span, so the whole request is one coherent trace.
    """
    client = _client_or_none()
    model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": message},
    ]

    def _create():
        kwargs = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": 800,
            "tools": _TOOLS,
        }
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

    # Annotate the workflow span with clean top-level input/output.
    LLMObs.annotate(input_data=message, output_data=reply)
    return reply


@chat_bp.post("/api/chat")
@require_auth
def chat():
    client = _client_or_none()
    if client is None:
        return jsonify({"error": "chat is not configured (missing OPENAI_API_KEY)"}), 503

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    try:
        reply = _run_chat(g.user_id, message)
    except Exception:
        logger.exception("chat completion failed")
        return jsonify({"error": "chat backend error"}), 502

    if not reply:
        logger.warning("chat: empty reply after %d tool round(s)", _MAX_TOOL_ROUNDS)
        reply = "Sorry, I couldn't generate a response just now. Please try again."
    return jsonify({"reply": reply})
