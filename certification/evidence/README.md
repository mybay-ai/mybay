# Runtime certification evidence

Store reviewable Runtime evidence bundles here as `<runtime-type>.certification.json`.

An evidence bundle records results; it does not execute tests by itself. Generate evidence only from an isolated Runtime or product E2E run, retain the referenced artifacts, and validate the bundle against `public/schemas/mybay.runtime-certification-evidence.schema.json`.

Do not commit API keys, passwords, cookies, private database snapshots, personal messages, or machine-specific secrets. Contract and unit tests are useful admission gates, but they cannot be labelled as `runtime` or `e2e` evidence.
