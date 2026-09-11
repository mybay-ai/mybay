# Runtime first-token acceptance

Use `scripts/runtime-first-token-acceptance.mjs` to measure the local control path, lifecycle feedback and first visible text for a real Pi or Codex instance. The script creates test conversations and sends real provider requests.

Set `LOCAL_ADMIN_PASSWORD` in the process environment or point `MYBAY_ENV_FILE` at a local environment file. Credential values and response text are not written to the result; the retained sample records only timing, identifiers, status and whether the exact random marker was returned.

```bash
node scripts/runtime-first-token-acceptance.mjs \
  --runtime codex \
  --instance 00000000-0000-4000-8000-000000000000 \
  --base-url http://127.0.0.1:3000 \
  --rounds 5 \
  --topology shared-session \
  --output data/runtime-first-token.json
```

Use `shared-session` to compare the first native turn with continued turns. Use `new-session` to create a separate native session for every sample. Restart the named test Runtime immediately before a `shared-session` run only when a container-cold first sample is required.

Treat control acceptance and lifecycle feedback as local product metrics. First visible text includes provider and model generation time and must not be used as a universal release threshold without a pinned model, account tier, host and Runtime image.
