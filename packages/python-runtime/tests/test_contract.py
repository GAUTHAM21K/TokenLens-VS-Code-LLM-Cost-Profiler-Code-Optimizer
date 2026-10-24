"""Phase 0 contract suite for ai_optimizer: frozen signatures, lazy LangChain, configs, fixtures.

Key exports: none (pytest module).
The golden-fixture parity tests run every case in packages/fixtures/{optimizer,router};
each must match byte for byte.
Feature: prompt optimizer + model router (Python runtime).
"""

from __future__ import annotations

import inspect
import json
import subprocess
import sys
from dataclasses import fields
from pathlib import Path

import pytest

import ai_optimizer
from ai_optimizer import (
    RouteDecision,
    get_model,
    load_router_config,
    load_techniques,
    optimize_messages,
    optimize_request,
    optimize_text,
    route,
)

PKG_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = PKG_ROOT.parent / "fixtures"
TIERS = {"economy", "standard", "advanced"}


def _cases(suite: str) -> list[dict]:
    return [
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted((FIXTURES / suite).glob("*.json"))
    ]


def _params(fn) -> list[str]:
    return list(inspect.signature(fn).parameters)


def test_frozen_signatures() -> None:
    assert _params(optimize_text) == ["text", "techniques", "config"]
    assert _params(optimize_request) == ["messages", "params", "techniques", "config"]
    assert _params(optimize_messages) == ["messages", "techniques", "config"]
    assert _params(route) == ["messages_or_text", "needs_tools", "config"]
    assert inspect.signature(route).parameters["needs_tools"].kind is inspect.Parameter.KEYWORD_ONLY
    assert _params(get_model) == ["messages_or_text", "kw"]
    assert [f.name for f in fields(RouteDecision)] == ["model", "provider", "tier", "reason"]


def test_import_without_langchain() -> None:
    code = (
        "import sys; sys.modules['langchain'] = None; "
        "import ai_optimizer; assert callable(ai_optimizer.optimize_text); "
        "assert callable(ai_optimizer.route)"
    )
    subprocess.run([sys.executable, "-c", code], cwd=PKG_ROOT, check=True)


def test_middleware_is_lazy() -> None:
    assert "ai_optimizer.middleware" not in sys.modules or "langchain" in sys.modules
    with pytest.raises(AttributeError):
        ai_optimizer.does_not_exist  # noqa: B018


def test_middleware_signatures() -> None:
    pytest.importorskip("langchain.agents.middleware")
    from ai_optimizer.middleware import ModelRouterMiddleware, PromptOptimizationMiddleware

    assert _params(PromptOptimizationMiddleware.__init__) == ["self", "techniques", "config"]
    assert _params(ModelRouterMiddleware.__init__) == ["self", "config"]
    for cls in (PromptOptimizationMiddleware, ModelRouterMiddleware):
        assert _params(cls.wrap_model_call) == ["self", "request", "handler"]


def test_default_configs_load() -> None:
    cfg = load_router_config()
    assert set(cfg["tiers"]) == TIERS
    assert cfg["rules"]["defaultTier"] in TIERS
    techniques = load_techniques()
    ids = [t["id"] for t in techniques["techniques"]]
    assert set(techniques["selected"]) <= set(ids)
    assert all(t["mode"] == "rule" for t in techniques["techniques"])


def test_fixture_suites_present() -> None:
    assert len(_cases("optimizer")) >= 2
    assert len(_cases("router")) >= 2
    for case in _cases("optimizer"):
        assert case["input"]["kind"] == case["expected"]["kind"]
    for case in _cases("router"):
        assert case["expected"]["tier"] in TIERS


@pytest.mark.parametrize("case", _cases("optimizer"), ids=lambda c: c["id"])
def test_optimizer_parity(case: dict) -> None:
    inp, exp = case["input"], case["expected"]
    if inp["kind"] == "text":
        assert optimize_text(inp["text"], case["techniques"], case.get("config")) == exp["text"]
    else:
        messages, params = optimize_request(
            inp["messages"], inp.get("params"), case["techniques"], case.get("config")
        )
        assert messages == exp["messages"]
        assert params == exp["params"]


def test_structured_data_minification_and_cache_prefix_protection() -> None:
    from ai_optimizer.techniques import optimize_request

    assert optimize_text('Payload: { "ok": true }', ["minify_structured_data"]) == (
        'Payload: {"ok":true}'
    )
    assert optimize_text('Payload: { "ok": true } done.', ["whitespace-normalize"]) == (
        'Payload: { "ok": true } done.'
    )
    assert optimize_text('Please { "ok": true }', ["filler-removal"], {
        "filler-removal": {"phrases": ["please"]}
    }) == '{ "ok": true }'
    messages, _ = optimize_request(
        [
            {"role": "system", "content": 'Static  system\n{"stable": true}'},
            {"role": "user", "content": "Please summarize this."},
        ],
        techniques=["cache-prefix-ordering", "whitespace-normalize", "caveman-output"],
        config={"caveman-output": {"instruction": "Be terse."}},
    )
    assert messages[0]["content"] == 'Static  system\n{"stable": true}'
    assert messages[1] == {"role": "system", "content": "Be terse."}


@pytest.mark.parametrize("case", _cases("router"), ids=lambda c: c["id"])
def test_router_parity(case: dict) -> None:
    inp = case["input"]
    subject = inp["text"] if inp["kind"] == "text" else inp["messages"]
    decision = route(subject, needs_tools=case["needsTools"], config=case["config"])
    exp = case["expected"]
    assert (decision.tier, decision.model, decision.provider) == (
        exp["tier"],
        exp["model"],
        exp["provider"],
    )


def test_router_complexity_and_long_repetitive_context() -> None:
    from ai_optimizer.router import evaluate_complexity

    cfg = load_router_config()
    code = "```ts\n    const result = input => { return { value: result }; }\n```"
    assert evaluate_complexity(code) >= 3
    assert route(code, config=cfg).tier == "standard"
    assert route("Give a proof for this claim", config=cfg).tier == "advanced"

    long_repetitive = "hello " * 40
    economy_cfg = {
        **cfg,
        "tiers": {
            **cfg["tiers"],
            "economy": [{**cfg["tiers"]["economy"][0], "contextWindow": 1000}],
        },
        "rules": {**cfg["rules"], "maxCharsForEconomy": 20},
    }
    no_context_cfg = {**cfg, "rules": {**cfg["rules"], "maxCharsForEconomy": 20}}
    assert route(long_repetitive, config=economy_cfg).tier == "economy"
    assert route(long_repetitive, config=no_context_cfg).tier == cfg["rules"]["defaultTier"]
