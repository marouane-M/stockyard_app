"""Append-only demo event journal, separate from any future governed database schema.
A successful append means flush+fsync. Raw and acceptance events are both retained.
"""
from __future__ import annotations
import json
import os
from pathlib import Path


class Journal:
    def __init__(self, path: Path | None):
        self.path = path
        self.memory: list[dict] = []
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)

    def read(self) -> list[dict]:
        if self.path is None:
            return list(self.memory)
        if not self.path.exists():
            return []
        data = self.path.read_bytes()
        lines = data.splitlines(keepends=True)
        events, good_end = [], 0
        for i, line in enumerate(lines):
            try:
                event = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                if i != len(lines)-1:
                    raise RuntimeError("Journal corrompu : démarrage interrompu, aucune perte silencieuse.")
                # Preserve a crash-truncated tail for operator inspection, then repair.
                self.path.with_suffix(".incomplete").write_bytes(line)
                with self.path.open("r+b") as f:
                    f.truncate(good_end)
                    f.flush()
                    os.fsync(f.fileno())
                break
            events.append(event)
            good_end += len(line)
        # A complete last JSON value without a newline still needs a delimiter.
        if data and events and not data.endswith(b"\n") and good_end == len(data):
            with self.path.open("ab") as f:
                f.write(b"\n")
                f.flush()
                os.fsync(f.fileno())
        return events

    def append(self, event: dict) -> None:
        encoded = (json.dumps(event, ensure_ascii=False, separators=(",", ":"), allow_nan=False)+"\n").encode()
        if self.path is None:
            self.memory.append(json.loads(encoded))
            return
        with self.path.open("ab") as f:
            f.write(encoded)
            f.flush()
            os.fsync(f.fileno())
