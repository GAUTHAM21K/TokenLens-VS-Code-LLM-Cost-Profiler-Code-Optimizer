"""Draft a customer reply by streaming a ChatGroq model (a multi-line ``stream`` call site).

Key exports: ``drafter``, ``draft_reply``.
Implement-flow target: one more P2/P3 site whose argument spans several lines and carries a
trailing comment, so the scanner's paren-balanced (not single-line regex) matching is exercised.
Not called by ``main.py`` (the demo stays at three Groq calls).
Feature: demo app for Implement optimization / model router.
"""

from __future__ import annotations

from langchain_groq import ChatGroq

drafter = ChatGroq(model="openai/gpt-oss-20b", temperature=0.2)


def draft_reply(ticket: str) -> str:
    """Stream a short reply to a support ticket and return the joined text."""
    chunks = drafter.stream(
        [
            ("system", "You write short, friendly support replies (max 3 sentences)."),
            ("user", f"Ticket:\n{ticket}"),  # the customer's own words
        ],
        config={"tags": ["demo"]},
    )
    return "".join(chunk.content for chunk in chunks)
