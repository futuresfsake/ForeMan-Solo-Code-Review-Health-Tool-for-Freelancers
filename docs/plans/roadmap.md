# Roadmap

Order is driven by dependencies, not appeal.

| Phase | Theme | Why here |
|---|---|---|
| 1 (M1) | CLI skeleton, project loader, parser | Everything needs files parsed and a place to report |
| 2 (M2) | Express adapter + `ProjectModel` | Auth/validation rules need routes and middleware; adapter boundary must be right before rules multiply |
| 3 (M3) | Rules, deps, config, score, checklist | The scanner's actual value; checklist and score are roll-ups of findings so they come after rules |
| 4 (M4) | Reports + real-project validation (gate) | Prove it finds true issues on the author's own live project; fix false positives before anything else |
| 5 (M5) | `scan --all`, history/trend, `init` | Multi-client view needs a stable single-project result and JSON schema |
| 6 (M6) | Senior review (LLM) | Needs trustworthy static findings as input (ADR-0002) |
| 7 (M7) | Risk-in-money, brandable client report | Needs stable findings and rule IDs to attach narratives to |
| 8 (M8) | Care mode samples | Needs `--fail-under`, JSON output, history |
| 9 (M9) | Explain-my-code | Reuses context builder from M6 |
| 10+ | NestJS / Fastify / Next.js adapters, PDF | Adapter interface proven on Express first |

## Dependency graph

```
M1 -> M2 -> M3 -> M4 (gate) -> M5 -> M8
                      |
                      +-> M6 -> M7
                           \-> M9
M2 -> M10+
```

Hard rule: no work on M6+ until M4's exit criteria pass.
