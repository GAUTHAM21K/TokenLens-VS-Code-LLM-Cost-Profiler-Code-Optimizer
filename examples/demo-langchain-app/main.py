"""Entry point of the demo LangChain app used to show the Implement flow end to end.

Key exports: ``main``.
Runs summarize + classify (plain invoke, one Groq request each) and one agent answer
(create_agent; its tool round-trip makes it two requests). After Implement, the same calls go
through ``ai_optimizer`` (optimized prompts, routed models) and the ``ai_optimizer`` logger
prints the router tier of every model call.
Feature: demo app for Implement optimization / model router.
"""

from __future__ import annotations

import logging
import os
import sys

TICKET = (
    "Hi team, my order A100 was charged twice on my card. Can you check the order status "
    "and refund the duplicate charge? Thanks in advance."
)


def main() -> int:
    """Run the demo calls; needs GROQ_API_KEY in the environment."""
    if not os.environ.get("GROQ_API_KEY"):
        print("Set GROQ_API_KEY to run the demo.", file=sys.stderr)
        return 1

    # Model replies may contain non-cp1252 characters (e.g. U+2011); don't crash on a Windows pipe.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(format="%(name)s: %(message)s")
    logging.getLogger("ai_optimizer").setLevel(logging.INFO)

    from summarizer import classify, summarize
    from support_agent import answer_ticket

    print("summary:", summarize(TICKET))
    print("label:", classify(TICKET))
    print("agent:", answer_ticket("What is the status of order A100?"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
