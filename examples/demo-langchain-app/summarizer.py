"""Summarize and classify support tickets with a ChatGroq model (plain ``invoke`` call sites).

Key exports: ``llm``, ``summarize``, ``classify``.
Implement-flow targets: one ChatXxx construction (P3, router) and two ``llm.invoke`` sites (P2).
Feature: demo app for Implement optimization / model router.
"""

from __future__ import annotations

from langchain_groq import ChatGroq

llm = ChatGroq(model="openai/gpt-oss-20b", temperature=0)


def summarize(ticket: str) -> str:
    """Return a short summary of a support ticket."""
    prompt = (
        "Please could you kindly read the following customer support ticket very carefully "
        "and then write a short summary of it.   Please keep it short.\n\n\n"
        f"Ticket:\n{ticket}"
    )
    return llm.invoke(prompt).content


def classify(ticket: str) -> str:
    """Return one label: billing, shipping, technical or other."""
    messages = [
        ("user", f"Ticket:\n{ticket}"),
        ("system", "Classify the ticket as exactly one of: billing, shipping, technical, other."),
    ]
    return llm.invoke(messages).content
