"""Support agent built with LangChain v1 ``create_agent`` and one tool.

Key exports: ``agent``, ``answer_ticket``, ``get_order_status``.
Implement-flow target: the ``create_agent(...)`` site (P1), which gets
``middleware=[PromptOptimizationMiddleware([...]), ModelRouterMiddleware()]``.
Feature: demo app for Implement optimization / model router.
"""

from __future__ import annotations

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

model = init_chat_model("openai/gpt-oss-120b", model_provider="groq")


def get_order_status(order_id: str) -> str:
    """Look up the shipping status of an order (demo data)."""
    return {"A100": "shipped", "A200": "processing"}.get(order_id, "unknown order")


agent = create_agent(
    model,
    tools=[get_order_status],
    system_prompt="You are a helpful support agent. Use tools to look up orders.",
)


def answer_ticket(question: str) -> str:
    """Run the agent on a customer question and return its final answer."""
    result = agent.invoke({"messages": [{"role": "user", "content": question}]})
    return result["messages"][-1].content
