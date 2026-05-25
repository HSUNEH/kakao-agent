# Kakao-agent room policy model

Kakao-agent is a privacy-first local messaging agent runtime, not an ad-hoc bot script. Runtime behavior must be explicit per room so future Kakao/LOCO/macOS adapters stay thin and testable.

## Canonical modes

| Mode                     | Intended room                  | Read/search | Inline replies       | Proactive sends | Memory                | Side effects                       | Notes                                         |
| ------------------------ | ------------------------------ | ----------- | -------------------- | --------------- | --------------------- | ---------------------------------- | --------------------------------------------- |
| `personal_assistant`     | personal DM / self room        | yes         | yes                  | no by default   | explicit, room-scoped | dry-run + confirmation             | owner-focused local assistant behavior        |
| `family_group`           | family or trusted group        | yes         | conservative yes     | no              | disabled by default   | dry-run + confirmation             | no surprise proactive messages                |
| `business_support`       | customer/business room         | yes         | yes with attribution | no              | disabled by default   | dry-run + confirmation + audit log | templates and source attribution are expected |
| `automation_bridge`      | command/control room           | yes         | commands only        | no              | disabled              | dry-run + confirmation + audit log | no free-response chat behavior                |
| `ignored`                | ignored room                   | no          | no                   | no              | disabled              | forbidden                          | routing checks only                           |
| `read_only_intelligence` | archival/search/summarize room | yes         | no                   | no              | disabled              | forbidden                          | current safe default for v0.1 MCP search      |

## Policy pipeline

```text
Kakao/LOCO/macOS event -> normalized MessageEvent -> room policy -> authorization -> memory scope -> side-effect gate -> action/read/silence
```

Platform adapters should translate events only. Decisions about room permission, response mode, memory, and side effects belong in pure policy modules under `src/policy/`.

## Safety rules

- Tests must not inherit live operator runtime variables such as `KAKAO_*`, `LOCO_*`, `HERMES_*`, `DISCORD_*`, `TELEGRAM_*`, or `SLACK_*` unless a test explicitly allowlists a variable.
- Memory is never cross-room by default. Even personal-assistant memory is room-scoped and requires explicit enablement.
- Sending or external effects require a dry-run preview and explicit confirmation.
- Read-only intelligence rooms can be searched/summarized but cannot send messages or perform external effects.
- Business/support actions require audit logs and source-attributed responses.

## Test fixtures

Canonical deterministic fakes live under `tests/fakes/`:

- `kakao-client.mjs` — stable fake chat/message client
- `loco-events.mjs` — normalized LOCO-like event fixtures
- `macos-bridge.mjs` — fake dry-run send bridge
- `rooms.mjs` — canonical room-mode fixtures

These fakes avoid import-order-dependent platform mocks and provide a shared base for future adapter tests.
