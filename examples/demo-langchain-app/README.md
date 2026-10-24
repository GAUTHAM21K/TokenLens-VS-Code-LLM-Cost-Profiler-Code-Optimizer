# Demo LangChain app (Groq)

Target project for the Token Optimizer **Implement** and **Router** demo (plan §3.3).

| file | call site | Implement pattern |
|---|---|---|
| `support_agent.py` | `create_agent(model, tools=..., system_prompt=...)` | P1 agent → add middleware |
| `summarizer.py` | `llm = ChatGroq(model=...)` | P3 construction (router) |
| `summarizer.py` | `llm.invoke(prompt)` in `summarize` | P2 invoke → `optimize_messages(...)` |
| `summarizer.py` | `llm.invoke(messages)` in `classify` | P2 invoke → `optimize_messages(...)` |
| `reply_drafter.py` | multi-line `drafter.stream([...], config=...)` (not called by `main.py`) | P2 invoke (paren-balanced, multi-line) |

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
GROQ_API_KEY=... python main.py   # 4 Groq requests: summarize, classify, agent (tool call + answer)
```

Golden planner tests (`packages/core/tests/implement/planner.golden.test.ts`) pin the exact
proposals for these files (optimizer only: 2 P2 + 1 multi-line P2 + 1 P1; router only or both:
the 3 invoke sites become P3 `get_model(...)` proposals). Phase 2 runs the app after Implement.
Do not reformat call sites without updating those tests.
