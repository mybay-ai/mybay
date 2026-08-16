# Optional advanced resource configuration

MyBay Open Source keeps manual per-instance CPU, memory, and disk policy management outside the default open-source experience. New instances use the host-protection defaults from `.env`, while Docker resource enforcement and disk guards remain active.

To restore the optional management UI and APIs for development, set:

```env
MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED=true
```

When disabled, deployment requests cannot override the configured defaults, resource-policy management APIs are unavailable, and editing unrelated settings preserves the resource values of existing instances.
