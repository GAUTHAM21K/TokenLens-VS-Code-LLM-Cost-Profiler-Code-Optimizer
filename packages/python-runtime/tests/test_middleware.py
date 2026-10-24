"""Middleware tests with LangChain's fake chat model (no network, no keys).

Key exports: none (pytest module). Skipped when LangChain is not installed (CI's lean venv).
Covers: messages rewritten, max_tokens capped, model swapped by tier; both direct
``wrap_model_call`` calls and a full ``create_agent`` run.
Feature: prompt optimizer + model router (Python runtime, agent-middleware integration).
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

pytest.importorskip("langchain.agents.middleware")

from langchain.agents import create_agent  # noqa: E402
from langchain.agents.middleware import ModelRequest  # noqa: E402
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402

from ai_optimizer import router  # noqa: E402
from ai_optimizer.middleware import (  # noqa: E402
    ModelRouterMiddleware,
    PromptOptimizationMiddleware,
)


class RecordingFake(GenericFakeChatModel):
    """Fake chat model that records the messages and call kwargs it receives."""

    calls: list = []

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # type: ignore[override]
        self.calls.append((list(messages), dict(kwargs)))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        return self.bind(**kwargs)


def _fake(name: str = "fake") -> RecordingFake:
    return RecordingFake(messages=iter([AIMessage(content=f"from {name}")] * 10), calls=[])


def _request(messages: list, *, system: str | None = None, model: Any = None, tools=None,
             settings: dict | None = None) -> ModelRequest:
    return ModelRequest(
        model=model or _fake(),
        messages=messages,
        system_message=SystemMessage(content=system) if system is not None else None,
        tools=tools or [],
        model_settings=settings or {},
    )


def _capture(seen: list):
    def handler(request: ModelRequest) -> AIMessage:
        seen.append(request)
        return AIMessage(content="ok")

    return handler


def test_prompt_middleware_rewrites_messages_and_caps_max_tokens() -> None:
    mw = PromptOptimizationMiddleware(
        ["whitespace-normalize", "filler-removal", "caveman-output", "max-output-cap"],
        {"caveman-output": {"instruction": "Be terse."}, "max-output-cap": {"maxTokens": 128}},
    )
    seen: list[ModelRequest] = []
    original = _request(
        [HumanMessage(content="Please   summarize   this.")], system="You help.",
        settings={"max_tokens": 1000},
    )
    mw.wrap_model_call(original, _capture(seen))
    req = seen[0]
    assert req.system_message.content == "You help.\n\nBe terse."
    assert [type(m) for m in req.messages] == [HumanMessage]
    assert req.messages[0].content == "Summarize this."
    assert req.model_settings["max_tokens"] == 128
    assert original.messages[0].content == "Please   summarize   this."  # input not mutated


def test_prompt_middleware_inserts_system_and_reads_model_max_tokens() -> None:
    mw = PromptOptimizationMiddleware(
        ["caveman-output", "max-output-cap"],
        {"caveman-output": {"instruction": "Be terse."}, "max-output-cap": {"maxTokens": 512}},
    )
    model = _fake()
    object.__setattr__(model, "max_tokens", 64)  # a model already capped below the limit
    seen: list[ModelRequest] = []
    mw.wrap_model_call(_request([HumanMessage(content="Hi")], model=model), _capture(seen))
    assert isinstance(seen[0].system_message, SystemMessage)
    assert seen[0].system_message.content == "Be terse."
    assert seen[0].model_settings["max_tokens"] == 64


def test_prompt_middleware_async() -> None:
    mw = PromptOptimizationMiddleware(["filler-removal"])
    seen: list[ModelRequest] = []

    async def handler(request: ModelRequest) -> AIMessage:
        seen.append(request)
        return AIMessage(content="ok")

    asyncio.run(mw.awrap_model_call(_request([HumanMessage(content="Just do it.")]), handler))
    assert seen[0].messages[0].content == "Do it."


@pytest.fixture
def fake_models(monkeypatch: pytest.MonkeyPatch) -> dict[str, RecordingFake]:
    models: dict[str, RecordingFake] = {}

    def init(model: str, provider: str, **kw: Any) -> RecordingFake:
        models[model] = _fake(model)
        return models[model]

    monkeypatch.setattr(router, "_init_model", init)
    return models


def test_router_middleware_swaps_model_by_tier(fake_models: dict[str, RecordingFake]) -> None:
    mw = ModelRouterMiddleware()
    seen: list[ModelRequest] = []
    mw.wrap_model_call(_request([HumanMessage(content="Hi")]), _capture(seen))
    assert seen[0].model is fake_models["openai/gpt-oss-20b"]
    assert mw.last_decision.tier == "economy"

    mw.wrap_model_call(_request([HumanMessage(content="Please debug this.")]), _capture(seen))
    assert seen[1].model is fake_models["qwen/qwen3.8-27b"]

    @tool
    def lookup(q: str) -> str:
        """Look something up."""
        return q

    mw.wrap_model_call(_request([HumanMessage(content="Hi")], tools=[lookup]), _capture(seen))
    assert seen[2].model is fake_models["openai/gpt-oss-120b"]
    assert mw.last_decision.tier == "standard"

    mw.wrap_model_call(_request([HumanMessage(content="Hello")]), _capture(seen))
    assert seen[3].model is seen[0].model  # models are cached per (provider, model)


def test_router_middleware_retries_empty_economy_response_with_advanced(
    fake_models: dict[str, RecordingFake],
) -> None:
    mw = ModelRouterMiddleware()
    seen: list[ModelRequest] = []
    responses = iter([AIMessage(content="  "), AIMessage(content="complete")])

    def handler(request: ModelRequest) -> AIMessage:
        seen.append(request)
        return next(responses)

    response = mw.wrap_model_call(_request([HumanMessage(content="Hi")]), handler)
    assert response.content == "complete"
    assert seen[0].model is fake_models["openai/gpt-oss-20b"]
    assert seen[1].model is fake_models["qwen/qwen3.8-27b"]


def test_router_middleware_retries_async_economy_exception_with_advanced(
    fake_models: dict[str, RecordingFake],
) -> None:
    mw = ModelRouterMiddleware()
    seen: list[ModelRequest] = []
    attempts = 0

    async def handler(request: ModelRequest) -> AIMessage:
        nonlocal attempts
        seen.append(request)
        attempts += 1
        if attempts == 1:
            raise RuntimeError("economy failed")
        return AIMessage(content="complete")

    response = asyncio.run(mw.awrap_model_call(_request([HumanMessage(content="Hi")]), handler))
    assert response.content == "complete"
    assert seen[0].model is fake_models["openai/gpt-oss-20b"]
    assert seen[1].model is fake_models["qwen/qwen3.8-27b"]


def test_create_agent_with_both_middlewares(fake_models: dict[str, RecordingFake]) -> None:
    default = _fake("default")
    agent = create_agent(
        default,
        system_prompt="You are helpful.",
        middleware=[
            PromptOptimizationMiddleware(
                ["filler-removal", "caveman-output", "max-output-cap"],
                {"caveman-output": {"instruction": "Be terse."},
                 "max-output-cap": {"maxTokens": 256}},
            ),
            ModelRouterMiddleware(),
        ],
    )
    result = agent.invoke({"messages": [HumanMessage(content="Could you please say hi?")]})
    assert result["messages"][-1].content == "from openai/gpt-oss-20b"
    assert default.calls == []
    sent, kwargs = fake_models["openai/gpt-oss-20b"].calls[0]
    assert [m.content for m in sent] == ["You are helpful.\n\nBe terse.", "Say hi?"]
    assert kwargs.get("max_tokens") == 256


def test_get_model_forwards_constructor_kwargs_to_init_chat_model() -> None:
    """The planner's ``get_model(arg, temperature=...)`` builds a real model with those kwargs."""
    placeholder = "not-a-real-credential"  # construction only; no request is sent
    model = router.get_model("Hi", temperature=0.2, max_tokens=64, api_key=placeholder)
    assert type(model).__name__ == "ChatGroq"
    assert model.model_name == "openai/gpt-oss-20b"
    assert model.temperature == 0.2
    assert model.max_tokens == 64


def test_get_model_logs_the_route(
    fake_models: dict[str, RecordingFake], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("INFO", logger="ai_optimizer"):
        router.get_model("Hi")
    assert "route: economy groq/openai/gpt-oss-20b" in caplog.text
