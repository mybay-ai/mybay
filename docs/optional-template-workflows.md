# Optional template workflow extension

MyBay Open Source defaults to standard Agent deployment and lifecycle management. The template center, Blueprints, workflow webhooks, and template scheduler remain available in the source tree as an optional extension, but are not loaded, shown, or executed by default.

Default configuration:

```env
TEMPLATE_CENTER_ENABLED=false
SCHEDULER_RUNNER_ENABLED=false
```

While disabled:

- the template-center navigation item is hidden;
- deployment opens the standard Agent wizard directly;
- `template_id`, `workflow_id`, and `blueprint_id` URL parameters are ignored;
- template and Blueprint deployment payloads are rejected by the server;
- template and workflow-webhook APIs are unavailable;
- template seeds are skipped and the template scheduler does not start;
- existing instances, SQLite data, and extension source code are preserved.

To restore the extension later, set both values to `true` in `.env` and rebuild the control panel:

```bash
docker compose up -d --build
```

Run template, webhook, file-input, and scheduled-workflow end-to-end checks again before treating the extension as production-ready.
