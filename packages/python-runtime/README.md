# ai_optimizer (Python runtime)

Source of truth for the `ai_optimizer/` package the extension exports into a user's workspace
(Implement flow). It has two parts:

- `techniques.py` and `router.py` use the standard library only. Their behaviour matches the TS
  core byte for byte; the golden fixtures in `packages/fixtures/{optimizer,router}` enforce that.
- `middleware.py` holds the LangChain v1 agent middlewares. LangChain is imported lazily, so
  `import ai_optimizer` works without it.

Config files sit next to the modules, and the exporter overwrites them:
- `catalog_techniques.json` holds the selected technique ids and their params.
- `router_config.json` holds the tiers, candidate models and rules.

## Usage

### Plain `llm.invoke` (the `invoke-wrap` integration)

```python
from ai_optimizer import optimize_messages, get_model

llm = get_model(prompt)                     # routed model via init_chat_model (needs LangChain)
reply = llm.invoke(optimize_messages(prompt))  # str or a list of messages; types are kept

# or the full request, including max_tokens from max-output-cap:
from ai_optimizer import optimize_request
messages, params = optimize_request(messages, {"max_tokens": 1000})
reply = llm.invoke(messages, **params)
```

### Agents (`create_agent`, the `agent-middleware` integration)

```python
from langchain.agents import create_agent
from ai_optimizer import PromptOptimizationMiddleware, ModelRouterMiddleware

agent = create_agent(
    "groq:openai/gpt-oss-120b",
    tools=[...],
    system_prompt="You are helpful.",
    middleware=[PromptOptimizationMiddleware(), ModelRouterMiddleware()],
)
```

- `PromptOptimizationMiddleware(techniques=None, config=None)` rewrites the system message and
  the messages on every model call. It also caps `max_tokens` through `model_settings`.
- `ModelRouterMiddleware(config=None)` swaps the model on every call using `route()`. A request
  that has tools counts as `needs_tools`. Each decision is logged on the `ai_optimizer` logger at
  INFO level and stored in `.last_decision`.
- Put the optimizer first, as shown above, so the router measures the optimized prompt.

Both middlewares implement `wrap_model_call` and `awrap_model_call`. They were verified against
`langchain==1.4.4` (langchain-core 1.6.9). The API they use:
- `ModelRequest.system_message`
- `ModelRequest.messages`
- `ModelRequest.model_settings`
- `ModelRequest.override(...)`

### Routing only

```python
from ai_optimizer import route
route("Analyze this architecture").tier   # "advanced"
```

## Development

```bash
python -m venv .venv && .venv/Scripts/pip install -r packages/python-runtime/requirements-dev.txt -r packages/python-runtime/requirements.txt
.venv/Scripts/python -m pytest packages/python-runtime
.venv/Scripts/ruff check packages/python-runtime
npx -y pnpm@12.10.1 python:bundle   # copies the package to packages/extension/resources/python/ai_optimizer/
```

The middleware tests skip when LangChain is not installed. They use a fake chat model and make no
network calls.
