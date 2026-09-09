# Pi / Codex Feishu integration — 2026-09-09

## Scope

Experimental MyBay control-plane Feishu adapter for existing Pi and Codex instances.
Hermes keeps its own container adapter. The native Runtime manifests continue to
advertise Web only; this work does not certify native IM support.

- Current entry: Agent → Manage → Agent settings → Feishu channel (experimental).
  This entry applies only to Pi/Codex. Hermes retains its existing channel form.
- Each Feishu app binds to one instance at a time. Test Pi first, disable that
  binding, then bind Codex; do not run competing connections for the same app.
- Explicit sender Open ID allowlist. Groups also require an allowed Chat ID and
  a bot mention. Conversations are isolated by owner, instance, app, chat and sender.
- SDK long connection receives text events and commits a durable inbox before
  returning. The normal Web run repository and reconciler execute the task.
- Replies use persisted chunk UUIDs for retry; remote duplicate suppression has
  a provider-defined retention window, so this is not an unlimited exactly-once
  delivery guarantee.
- `/stop` targets only the sender's mapped conversation and persists the exact
  target before requesting cancellation. Acceptance of stop is not confirmation
  that execution has stopped.
- Approvals and Pi follow-up questions are handled on the Web in this first
  phase. IM approval cards/commands, attachments and streaming cards remain pending.

## Storage and rollout

Schema 8 adds `channelMessages` to the normal local database/backup. Back up the
control database before upgrading. An older control image cannot open schema 8;
rollback requires its matching schema-7 backup. Credentials use the existing
AES-GCM instance-secret mechanism and are omitted from configuration responses.
No credentials belong in this report or Git.

## Test application

User created the dedicated app named `MyBay Pi Codex`.
Read-only API checks passed: tenant authentication and bot identity lookup.
The user reports that only app creation has been completed. Event permissions,
long-connection subscription and a published test version still require setup.

Setup order:
1. In the Feishu developer console, enable the bot capability.
2. Grant the receive-private-message, receive-group-mention and send-as-bot
   permissions required by the message event and reply API. Keep availability
   restricted to the test users.
3. Configure the dedicated app in MyBay with the test user's app-scoped Open ID.
4. With the MyBay listener running, select long connection in event settings and
   subscribe to `im.message.receive_v1`.
5. Publish the test version. Test private chat, group mention, duplicate delivery,
   Web history, cancellation, restart recovery and permission denial for both Runtimes.

Official references:
- https://github.com/larksuite/node-sdk/blob/main/README.md
- https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- https://open.feishu.cn/document/server-docs/im-v1/message/reply

## Evidence boundary

- PASS: inbound policy, SQLite reopen/replay, identity isolation, bounded inbox,
  retry UUID preservation, Unicode chunks, scoped cancellation, configuration
  authentication/ownership, encrypted secret storage, duplicate app rejection.
- PASS: 35 focused automated tests across the inbox, worker, configuration API,
  sanitizer and database migration suites; TypeScript, strict core/boundary checks,
  targeted ESLint, locale-key parity and production build.
- PASS: dedicated app authentication and bot metadata lookup.
- PASS: control image `mybay/local:feishu-managed-20260909` deployed at
  `http://localhost:3000`; health HTTP 200 and container healthy. Pi configuration
  form observed in the real browser (dark appearance), including its experimental
  label, secret input and allowlist fields. No binding was enabled during UI QA.
- Before migration: schema-7 backup
  `backups/codex-open-20260909-1788961765323`, SQLite integrity check `ok`.
- NOT RUN: real Feishu message → Pi/Codex run → Feishu reply, published-app
  permissions, real group handling, Runtime recovery and real form submission.
- NOT IMPLEMENTED in phase 1: IM approvals/questions and attachments.

The end-to-end IM chain is not yet certified or closed.

## Entry correction

Moved the Pi/Codex form out of A2A into the channel position of Agent settings.
The Hermes `AppSettingsChannelSection` and every supplied prop are unchanged;
no backend, credentials, channel configuration or Runtime container was changed.
TypeScript, targeted ESLint and production build passed. Real localhost browser
checks confirmed the Pi form in settings and the original Hermes channel selector.
Codex uses the same explicit branch; no live Codex instance was available for this
UI check. All 12 running Agent container IDs and start times were unchanged after
the control-only update, and health returned HTTP 200.
Local image: `mybay/local:feishu-settings-20260910` (derived from the prior local
image with the rebuilt application bundle). Real Feishu send/receive was not run.

## Pi/Codex QR binding

Reused the existing authenticated Feishu QR onboarding endpoints. The response
now optionally includes the scanned user's validated Open ID from `user_info.open_id`.
Hermes request parameters and its settings UI are unchanged. The Pi/Codex form
fills credentials and the new app's user allowlist, clears old app-scoped IDs,
and requires explicit enable/save. Cancelling, replacing or leaving a QR session
prevents late results from being applied. No credentials are retained in QR display state.

- PASS: 5 QR onboarding tests, TypeScript, targeted ESLint, production build.
- PASS: real localhost Pi settings generated a pending Feishu QR code.
- PASS: local image `mybay/local:feishu-qr-20260910`, health HTTP 200, healthy.
- PASS: all 12 running Agent container IDs/start times unchanged.
- PENDING USER: scan and authorize a dedicated test application.
- NOT RUN: completed live QR binding, enabled config save, real Pi/Codex IM round trip.
- Codex shares the Pi/Codex settings component; no live Codex UI acceptance yet.

Official field reference:
https://github.com/larksuite/cli/blob/main/internal/auth/app_registration.go

## Live Pi private-message acceptance (2026-09-09)

PASS: QR completion populated the dedicated test application and scanned user's
allowlist; the enabled binding was saved through the real settings UI.
PASS: a real Feishu private message reached Pi instance
`af4c9c26-30f9-4acb-afb0-6e9c80978870` and produced completed run
`d334b906-5b69-4a94-970b-0280894c1041`.
PASS: receipt `7949271547e298fbd620302d953cdf9d3c6633e219ac47ddc2ec2165f0af1c9b`
advanced from submitted to finished. Its single persisted reply chunk has
`sent: true`, which is written only after the Feishu reply API succeeds.
The user's Feishu client display was not independently observed.

This proves one real Pi private-text round trip. Codex, groups, /stop,
reconnect/restart recovery and IM approval flows are not covered by this result.

## Live Codex private-message acceptance (2026-09-09)

PASS: ChatGPT OAuth credential was saved through the deployment UI. New instance
`4ee3c436-e6e7-4a2f-816f-843941db6db6` runs `mybay/codex-runtime:0.153.4`.
Runtime and Chat API readiness passed. A separate Feishu application was QR-bound
and enabled; the existing Pi binding was preserved.
PASS: real private message produced completed Codex run
`728f89af-d2fe-4f51-ba97-45b8aae86ba0` with non-empty model output.
PASS: receipt `22108511e0c6eb3cd83bd50442f13317a1dc69ea7c1fae2cb9d76fc04342a3e4`
reached `finished`; reply chunk `1a048b1f-acfd-4fd1-b612-c32f72246888` has
`sent: true`, indicating successful Feishu reply API response. The user's client
rendering was not independently observed.

Pi and Codex each now have a real basic private-text round trip. This does not
certify groups, cancellation, reconnect/restart recovery, attachments or IM approvals.
Open UI issue: the Codex management dialog labels the runtime as Hermes; actual
stored runtime and Docker image were verified as Codex. Display correction pending.

## Runtime display and access-policy correction

Fixed Codex naming in management, grid and table version labels. Dashboard
support now permits Hermes only; Codex settings show a dedicated workspace notice.
Hermes Dashboard behavior is retained. PASS: 3 access-policy tests, 4 Feishu worker
tests, TypeScript, targeted ESLint and production build.
Local image `mybay/local:codex-display-20260910` deployed; HTTP health 200 and all
13 running Agent container start times unchanged. Real post-restart Feishu
round trips and dedicated group preparation are awaiting user test messages.

## Live control-panel restart recovery (2026-09-09)

After the control-only update to `mybay/local:codex-display-20260910`, both
previously enabled Feishu bindings received new private messages without rescanning:
- Codex run `6c33f962-b2d3-4732-bfec-b9e2eb7ef47d`: completed;
  receipt `cf8b28c71a7fc90142f6ca68814b8caba0b6f099db47fec565cfe6380a93ac10`: finished.
- Pi run `a70686f5-802a-4ac2-9c19-fba0876dd6bd`: completed;
  receipt `792c3523b7cb4159afeb221ca0a5f1f84f2328a548e43b7e457f6756ddffad12`: finished.
Both reply chunks have `sent: true`. This verifies reconnection and new-message
processing after a control-panel restart. It does not verify an interrupted active
run, network partition, Runtime container restart, groups or live cancellation.

## Live group-message acceptance (2026-09-10)

PASS: two new messages in the explicitly allowlisted test group reached the
corresponding Pi/Codex instances. Both runs completed and both inbox receipts
reached finished with all reply chunks sent through the Feishu reply API.
- Pi run: cf0358d2-bcbf-4cbd-bb54-69f21868777a;
  conversation: a106d19b-23ea-41f1-92bf-14f513fe4641.
- Codex run: d3f6fb98-de60-4fca-ba40-9c6c3c23bd40;
  conversation: a60ff436-3323-471d-bc07-b31b3232125b.
The conversations are separate. No filtered-event diagnostic was observed for
this attempt. The cause of earlier missing events remains unknown; rich-text
filtering was a hypothesis, not a verified cause. No-mention behavior and live
cancellation remain unverified. The local diagnostic image remains active.

## No-mention observation (2026-09-10)

User reported sending an unmentioned group message. Two database observations
15 seconds apart showed the same two prior group receipts and completed runs,
with no additional execution. No filtered-event diagnostic appeared in the
preceding five-minute window. Observed outcome: no unwanted task triggered.
This does not prove live local-parser rejection: delivery of the unmentioned
event to the application was not observed. Platform-side event filtering remains
possible; the local exact-mention guard is covered by automated tests only.
