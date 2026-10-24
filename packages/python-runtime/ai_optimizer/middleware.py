"""LangChain v1 agent middlewares that plug the optimizer and router into ``create_agent``.

Key exports: ``PromptOptimizationMiddleware`` (rewrites request messages with the selected
techniques and caps ``max_tokens``) and ``ModelRouterMiddleware`` (swaps the request model per
``route()``), both hooking ``wrap_model_call`` / ``awrap_model_call``. Importing this module
requires LangChain; the package imports it lazily.
Feature: prompt optimizer + model router (Python runtime, agent-middleware integration).

API used (verified against langchain==1.4.4 / langchain-core 1.6.9): ``AgentMiddleware``,
``ModelRequest.system_message`` (the agent's system prompt, kept outside ``request.messages``),
``ModelRequest.model_settings`` (kwargs bound to the model per call) and
``ModelRequest.override(messages=, system_message=, model=, model_settings=)``.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

try:
    from langchain.agents.middleware import AgentMiddleware
    from langchain_core.messages import SystemMessage
except ImportError as exc:  # pragma: no cover - exercised only without LangChain installed
    raise ImportError(
        "ai_optimizer.middleware needs LangChain v1: pip install -r requirements.txt"
    ) from exc

from . import router
from .techniques import optimize_request

logger = logging.getLogger("ai_optimizer")


def _all_messages(request: Any) -> list[Any]:
    """The prompt as the model sees it: system message first, then the conversation."""
    system = [request.system_message] if request.system_message is not None else []
    return [*system, *request.messages]


class PromptOptimizationMiddleware(AgentMiddleware):
    """Apply prompt-optimization techniques to every model request of an agent."""

    def __init__(self, techniques: list[str] | None = None, config: dict | None = None) -> None:
        """Use ``techniques`` (default: the exported selection) with optional param overrides."""
        super().__init__()
        self.techniques = techniques
        self.config = config

    def _rewrite(self, request: Any) -> Any:
        settings = dict(request.model_settings or {})
        existing = settings.get("max_tokens", getattr(request.model, "max_tokens", None))
        params = {"max_tokens": existing} if isinstance(existing, int) else {}
        messages, params = optimize_request(
            _all_messages(request), params, self.techniques, self.config
        )
        system = None
        if messages and isinstance(messages[0], SystemMessage):
            system, messages = messages[0], messages[1:]
        if "max_tokens" in params:
            settings["max_tokens"] = params["max_tokens"]
        return request.override(messages=messages, system_message=system, model_settings=settings)

    def wrap_model_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        """Rewrite ``request.messages`` (and max_tokens) before calling ``handler``."""
        return handler(self._rewrite(request))

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        """Async variant of ``wrap_model_call`` (``agent.ainvoke`` / ``astream``)."""
        return await handler(self._rewrite(request))


class ModelRouterMiddleware(AgentMiddleware):
    """Route each agent model call to the tier model chosen by ``ai_optimizer.router.route``."""

    def __init__(self, config: dict | None = None) -> None:
        """Use ``config`` (a RouterConfig dict) or the exported ``router_config.json``."""
        super().__init__()
        self.config = config
        self.last_decision: router.RouteDecision | None = None
        self._models: dict[tuple[str, str], Any] = {}

    def _rewrite(self, request: Any) -> Any:
        decision = router.route(
            _all_messages(request), needs_tools=bool(request.tools), config=self.config
        )
        self.last_decision = decision
        logger.info("route: %s %s/%s (%s)", decision.tier, decision.provider, decision.model,
                    decision.reason)
        key = (decision.provider, decision.model)
        if key not in self._models:
            self._models[key] = router._init_model(decision.model, decision.provider)
        return request.override(model=self._models[key])

    def _advanced_request(self, request: Any) -> Any:
        config = self.config or router._default_config()
        candidates = config["tiers"].get("advanced", [])
        if not candidates:
            return request
        candidate = candidates[0]
        key = (candidate["providerId"], candidate["modelId"])
        if key not in self._models:
            self._models[key] = router._init_model(candidate["modelId"], candidate["providerId"])
        logger.warning(
            "economy response incomplete; retrying with advanced model %s",
            candidate["modelId"],
        )
        return request.override(model=self._models[key])

    @staticmethod
    def _complete(response: Any) -> bool:
        result = getattr(response, "result", response)
        messages = result if isinstance(result, list) else [result]
        nonempty = False
        for message in messages:
            content = getattr(message, "content", message if isinstance(message, str) else None)
            if isinstance(content, str) and content.strip():
                nonempty = True
            elif isinstance(content, list) and any(
                (isinstance(block, str) and bool(block.strip()))
                or (isinstance(block, dict) and bool(str(block.get("text", "")).strip()))
                for block in content
            ):
                nonempty = True
            if nonempty:
                break
        else:
            nonempty = False
        metadata = getattr(messages[-1], "response_metadata", {}) if messages else {}
        metadata = metadata or {}
        finish = str(metadata.get("finish_reason", metadata.get("stop_reason", ""))).lower()
        return nonempty and finish not in {"length", "max_tokens", "error"}

    def wrap_model_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        """Replace ``request.model`` with the routed model (tools present => needs_tools)."""
        routed = self._rewrite(request)
        try:
            response = handler(routed)
        except Exception:
            if self.last_decision is None or self.last_decision.tier != "economy":
                raise
            return handler(self._advanced_request(routed))
        if (
            self.last_decision is not None
            and self.last_decision.tier == "economy"
            and not self._complete(response)
        ):
            return handler(self._advanced_request(routed))
        return response

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        """Async variant of ``wrap_model_call``."""
        routed = self._rewrite(request)
        try:
            response = await handler(routed)
        except Exception:
            if self.last_decision is None or self.last_decision.tier != "economy":
                raise
            return await handler(self._advanced_request(routed))
        if (
            self.last_decision is not None
            and self.last_decision.tier == "economy"
            and not self._complete(response)
        ):
            return await handler(self._advanced_request(routed))
        return response
