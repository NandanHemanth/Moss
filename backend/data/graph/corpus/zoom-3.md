# Platform Sync

- Source: Zoom
- Date: 2026-10-03
- topic: Platform Sync
- start_time: 2026-10-03T14:00:00-04:00
- participants: Dana Kim, Priya Shah, Marcus Lee

Dana Kim: First item: the summarisation endpoint. Costs on Claude went up 30% this month.
Priya Shah: I can put OpenAI behind an LLM_PROVIDER flag so we can switch per tenant.
Marcus Lee: Then I'll need to update the load tests for the new provider.
Dana Kim: Agreed. Decision: move /v1/summarise from Claude to OpenAI behind a provider flag. Priya owns the backend change, Marcus updates the load tests. Target: end of next sprint.
Priya Shah: I'll also share the current load-test baseline with Marcus by Monday.
Marcus Lee: PLAT-212 is still blocked on the vendor API key, and it's due Friday. That's a risk.
Dana Kim: Let's kick off the migration Tuesday at 10.
