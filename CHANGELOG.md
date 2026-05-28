# Changelog

## 0.2.0 - Bootstrap backfill foundation

- Added `kakao-agent bootstrap` to backfill whitelisted rooms from KakaoTalk text export files with idempotent per-room state in `~/.kakao-agent/bootstrap-state.yaml`; `--force` rebuilds existing export rows for target room(s).
- Added export parsing for Korean KakaoTalk timestamps, multiline messages, system events, emoticon/media labels, and raw fallback rows.
- Added DB migration columns `source` and `parse_status`, plus `bootstrap_meta.install_time`; MCP tool outputs remain v0.1-compatible and do not expose those internal fields.
- Added preflight checks for macOS Accessibility and KakaoTalk app/version before live bootstrap automation.
- Added fixture-based e2e coverage for `summarize_room`, `search_messages`, and `cross_room_query` over export backfill data.
