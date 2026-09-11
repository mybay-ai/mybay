#!/usr/bin/env python3
"""Add display-safe interim assistant events to Hermes' native Runs SSE API."""

from __future__ import annotations

import sys
from pathlib import Path


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(old, new, 1)


def patch_api_server(source: str) -> str:
    if '"event": "message.interim"' in source:
        return source

    create_start = source.find("    def _create_agent(")
    if create_start < 0:
        raise RuntimeError("Hermes _create_agent method was not found")
    create_end = source.find("\n    def ", create_start + 1)
    if create_end < 0:
        create_end = len(source)
    create_method = source[create_start:create_end]
    create_method = _replace_once(
        create_method,
        "        stream_delta_callback=None,\n        tool_progress_callback=None,",
        "        stream_delta_callback=None,\n        interim_assistant_callback=None,\n        tool_progress_callback=None,",
        "agent callback signature",
    )
    create_method = _replace_once(
        create_method,
        '            "stream_delta_callback": stream_delta_callback,\n            "tool_progress_callback": tool_progress_callback,',
        '            "stream_delta_callback": stream_delta_callback,\n            "interim_assistant_callback": interim_assistant_callback,\n            "tool_progress_callback": tool_progress_callback,',
        "agent callback forwarding",
    )
    source = source[:create_start] + create_method + source[create_end:]

    runs_marker = "        # Also wire stream_delta_callback so message.delta events flow through."
    runs_start = source.find(runs_marker)
    if runs_start < 0:
        raise RuntimeError("Hermes Runs text callback anchor was not found")
    status_anchor = "\n        self._set_run_status("
    insert_at = source.find(status_anchor, runs_start)
    if insert_at < 0:
        raise RuntimeError("Hermes Runs status anchor was not found")
    callback = '''

        interim_counter = itertools.count(1)

        def _interim_cb(text: Optional[str], *, already_streamed: bool = False) -> None:
            """Publish completed, display-safe commentary that was not token-streamed."""
            if already_streamed or not isinstance(text, str):
                return
            visible = redact_sensitive_text(text.strip(), force=True)
            if not visible:
                return
            visible = visible[:8192]
            sequence = next(interim_counter)
            try:
                loop.call_soon_threadsafe(_put_event_if_active, {
                    "event": "message.interim",
                    "run_id": run_id,
                    "id": f"{run_id}:interim:{sequence}",
                    "timestamp": time.time(),
                    "text": visible,
                    "already_streamed": False,
                })
            except Exception:
                pass
'''
    source = source[:insert_at] + callback + source[insert_at:]

    agent_marker = "                        stream_delta_callback=_text_cb,\n                        tool_progress_callback=event_cb,"
    source = _replace_once(
        source,
        agent_marker,
        "                        stream_delta_callback=_text_cb,\n                        interim_assistant_callback=_interim_cb,\n                        tool_progress_callback=event_cb,",
        "Runs agent construction",
    )
    return source


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_api_server.py /path/to/api_server.py")
    path = Path(sys.argv[1])
    original = path.read_text(encoding="utf-8")
    patched = patch_api_server(original)
    path.write_text(patched, encoding="utf-8")


if __name__ == "__main__":
    main()
