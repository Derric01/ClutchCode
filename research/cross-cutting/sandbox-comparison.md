# Cross-cutting: Sandbox comparison

Synthesized from Codex (`codex-rs/linux-sandbox/`, verified) + repo notes. Feeds PROJECT_SPEC §12.

## What each project does

| Project | Isolation | Default on laptop? | Network control | Notes |
|---|---|---|---|---|
| Codex | **tiered OS**: Seatbelt (mac), Landlock+seccomp+bwrap (Linux), windows-sandbox | yes (lightweight) | policy-based | **strongest**; approval-policy modes (read-only/workspace-write/full) |
| OpenHands | **Docker container** | heavy (many disable) | container net | strong but a non-starter for many Profile B/C |
| Aider | none (confirm shell only) | n/a | none | trust-the-user |
| Cline/Roo/Kilo | approval only (runs with editor perms) | n/a | none | human gate, no confinement |
| smolagents | pluggable (e2b/docker/wasm) for code-actions | varies | varies | library choice |
| SWE-agent | container-per-task | heavy | container | benchmark harness |
| **ClutchCode** | **tiered, laptop-first** (§12.6): Tier0 policy always; Tier1 Seatbelt/bwrap+Landlock/WSL2; Docker=opt-in Tier2 | **yes (Tier1 lightweight)** | **default-deny + allowlist** | Docker NOT default |

## Isolation mechanisms for individual developers (honest)

| Mechanism | Startup | macOS FS perf | GPU passthrough (local model) | Strength | Verdict |
|---|---|---|---|---|---|
| process + policy | ~0 | native | n/a | weak | always-on floor |
| macOS Seatbelt (`sandbox-exec`) | low | native | host unaffected | good | **mac default** |
| Linux bubblewrap | low | native | host unaffected | good | **Linux default** |
| Linux Landlock+seccomp | low | native | unaffected | strong (fs+syscall) | layer under bwrap |
| Windows restricted-token/AppContainer | med | n/a | unaffected | medium | weak story ([C:Low]) |
| WSL2 | med | good in-distro | **CUDA works** | good | **Profile-B Windows path** |
| Docker/Podman | **high** | **poor (virtiofs)** | **painful, esp. mac** | strong | **opt-in only** |
| Firecracker microVM | high | good | complex | strongest | out of Phase 1 scope |

## Key judgment (contra OpenHands)
**Docker is not a free default on a laptop:** daemon startup, multi-GB images, slow bind-mounts on macOS, and it **fights local-model GPU passthrough** — so users disable it and end up *less* safe than a lightweight always-on OS sandbox. ClutchCode makes Tier1 (Seatbelt/bwrap+Landlock/WSL2) the default and Docker an opt-in stronger tier.

## Reusable / do-not-copy
- **Reusable:** Codex's **approval-policy modes** + tiered OS primitives (studied, reimplemented clean-room from OS docs — LICENSE §3); child-env scrubbing; egress default-deny.
- **Do-not-copy:** Docker-as-default (OpenHands); no-sandbox (Aider/Cline). Codex's Seatbelt policy strings + Landlock rulesets are **CLEAN-ROOM-REQUIRED** — author independently.
- **Honesty:** §12.7 enumerates what none of Tier0/1 protects against (prompt-injection into allowed actions, malicious deps under normal perms, sandbox-escape bugs). We claim no property we didn't build a control for.
