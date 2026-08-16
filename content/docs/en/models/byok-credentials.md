---
title: BYOK model credentials
description: Securely store your own model API key in MyBay Open Source and reuse it when deploying Agents.
updatedAt: 2026-08-14
keywords:
  - BYOK
  - API key
  - model provider
  - credentials
---

## What BYOK means

BYOK means Bring Your Own Key: you use your own model-provider account and API key. MyBay Open Source does not supply hosted model allowances. Pricing, regional availability, and rate limits are controlled by your provider.

## Add a credential

1. Sign in to the local console.
2. Open Credentials.
3. Select Add credential.
4. Enter a recognizable name.
5. Choose the provider type.
6. Enter the actual API key and save it.

The server encrypts the credential with `ENCRYPTION_KEY` before writing it to local storage. List responses are masked and do not send the complete key back to the browser.

> [!DANGER]
> Never put an API key in documentation, screenshots, chat messages, or Git. Do not commit `.env` or `data/` when they contain credentials.

## Use a credential in an instance

When creating or editing an instance, select a provider, a saved credential, and a supported model. If the credential has been removed or cannot be decrypted, deployment stops instead of writing an invalid configuration.

BYOK is the default model source in the open-source edition. Hosted model selection is not provided.

## Custom compatible services

Choose the custom type to provide an OpenAI-compatible base URL, such as a self-hosted gateway or local model service.

The server applies SSRF safety checks to the base URL. Protected internal targets, unsupported protocols, and addresses that violate the safety policy are rejected.

> [!TIP]
> A local model service must be reachable from the MyBay control plane or the Agent container network. Browser access alone does not prove container connectivity.

## Update and rotate keys

When editing, leaving the masked placeholder unchanged preserves the stored key. To rotate it, enter the new actual key, save, then update or redeploy instances that use the credential.

Plan credential migration before changing `ENCRYPTION_KEY`. Replacing it directly can make existing credentials unreadable.

## Delete a credential

Confirm that no instance still depends on the credential. Deleting it does not automatically choose another model configuration for existing instances, so later deployments, updates, or tasks may fail.

## Troubleshooting

- Save rejected: complete the name, type, and API key, and do not submit a masked placeholder.
- Custom URL rejected: verify the protocol, host, and SSRF restrictions.
- Provider returns 401 or 403: confirm key validity and permissions with the provider.
- Container cannot connect: check DNS, proxies, Docker networking, and provider region restrictions.
- Instance still uses old configuration: save the instance configuration and update or redeploy it.
