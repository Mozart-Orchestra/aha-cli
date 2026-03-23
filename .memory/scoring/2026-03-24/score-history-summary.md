# Score history summary

Generated at: 2026-03-23T19:00:38.024Z

## 1句
Score history is durably persisted and queryable: 15 score entries across 5 sessions.

## 3句
1. Canonical score path resolves to `/Users/copizza/.aha-v3/scores/agent_scores.json`; existing score files: `/Users/copizza/.aha-v3/scores/agent_scores.json`.
2. Filtered view contains 15 scores across 5 sessions, 3 roles, and 1 teams.
3. Latest score timestamp: 2026-03-23T18:46:50.036Z; distribution = excellent 3, good 10, fair 2, poor 0.

## 5句
1. Canonical score storage is package-aware, not hardcoded to `~/.aha`.
2. For this repo/package, the active home is usually `~/.aha-v3`, where score history already exists.
3. Legacy score locations remain readable for backward compatibility, including `~/.aha/scores/agent_scores.json` and `<cwd>/.aha/scores/agent_scores.json`.
4. This summary can be regenerated for future scoring cycles, so benchmark re-measure no longer depends on ad hoc manual inspection.
5. Remaining observability gaps such as trace richness or telemetry completeness should be tracked by their own benchmarks, not confused with score persistence.

## By role

| Role | Count | Avg | Min | Max | Latest | Latest at |
|------|------:|----:|----:|----:|-------:|-----------|
| builder | 9 | 77.9 | 63 | 86 | 85 | 2026-03-23T18:46:48.834Z |
| master | 3 | 81 | 77 | 84 | 82 | 2026-03-23T18:46:50.036Z |
| scout | 3 | 82.7 | 75 | 91 | 91 | 2026-03-23T18:46:49.440Z |

## By session

| Session | Role | Count | Latest | Action | Latest at |
|---------|------|------:|-------:|--------|-----------|
| cmn3hbync003nqj239jnd1bvy | master | 3 | 82 | keep | 2026-03-23T18:46:50.036Z |
| cmn3hc9nv004dqj23tshhf87s | scout | 3 | 91 | keep | 2026-03-23T18:46:49.440Z |
| cmn3hc6lq0045qj23tv4dl8zo | builder | 3 | 85 | keep | 2026-03-23T18:46:48.834Z |
| cmn3hc3xq003zqj23gwl1x6a7 | builder | 3 | 86 | keep | 2026-03-23T18:46:48.195Z |
| cmn3hc15h003rqj23maulmk9r | builder | 3 | 83 | keep | 2026-03-23T18:46:47.232Z |

## By team

| Team | Count | Roles | Latest at |
|------|------:|-------|-----------|
| 6d609c73-84f9-4162-b0d6-c5dacb1e4fbc | 15 | master:3, scout:3, builder:9 | 2026-03-23T18:46:50.036Z |
