"""Per-request record of which agents and memory layers were used, and what was cited."""

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Trace:
    steps: list[dict[str, str]] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    proposals: list[dict[str, Any]] = field(default_factory=list)

    def step(self, agent: str, text: str) -> None:
        self.steps.append({"agent": agent, "text": text})

    def cite(self, label: str) -> None:
        if label not in self.citations:
            self.citations.append(label)


_current: ContextVar[Trace | None] = ContextVar("moss_trace", default=None)


def start() -> Trace:
    trace = Trace()
    _current.set(trace)
    return trace


def current() -> Trace:
    # Tools can run outside an /api/ask request (e.g. via the AG-UI endpoint); record into a throwaway trace then.
    return _current.get() or Trace()
