# Hermes interim events compatibility image

This local acceptance image adds one optional event to Hermes' native Runs API:

```json
{"event":"message.interim","id":"run_...:interim:1","text":"...","already_streamed":false}
```

The event contains Hermes' existing display-safe interim assistant message. It is emitted only when that message was not already delivered through `message.delta`. MyBay renders it as timeline commentary and keeps final answer deltas separate.

Build against a pinned Hermes version:

```sh
docker build --build-arg HERMES_BASE_IMAGE=nousresearch/hermes-agent:v2026.8.27 -t mybay/hermes-agent:v2026.8.27-interim server/runtimePatches/hermes-interim-events
```

The patcher fails closed when the expected upstream anchors change. Rebase the patch after inspecting the new Hermes Runs implementation; do not silently publish an unpatched image.
