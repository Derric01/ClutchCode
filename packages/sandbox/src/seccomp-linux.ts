import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Linux Tier 1 hardening (PROJECT_SPEC.md §12.6: "Linux Landlock + seccomp
 * | ... | layered under bwrap where available"): a seccomp-bpf filter
 * layered under bwrap's existing namespace confinement. Denies a
 * defense-in-depth set of syscalls a normal dev/build/test workflow
 * (npm, git, python, shell, compilers) never legitimately needs, but that
 * are common sandbox-escape / privilege-escalation / kernel-exploit
 * primitives — extra protection in case a namespace-level boundary is
 * ever bypassed, not a replacement for it.
 *
 * **Landlock (the other half of §12.6's line) is NOT implemented this
 * pass**, stated plainly rather than silently dropped: unlike seccomp's
 * frozen, publicly documented classic-BPF bytecode format, applying
 * Landlock correctly needs either a native helper binary or a raw-syscall
 * binding, and there is no vetted TypeScript/Node library for it and no
 * way to verify a hand-rolled one against this kernel without real risk
 * of a subtly wrong implementation. Seccomp is a different, safer bet
 * here specifically because its output is directly, empirically testable
 * end to end (see `seccomp-linux.test.ts`) — if the bytecode were
 * assembled wrong, the denied syscalls simply wouldn't be blocked, or
 * `bwrap` would refuse to load a malformed program, either of which the
 * test suite catches. Landlock's failure mode (a slightly-wrong rule
 * silently granting more access than intended) is a worse category of
 * mistake to risk without that same empirical backstop.
 *
 * **x86_64 only, this pass.** The BPF program is hand-assembled directly
 * in TypeScript — the same classic-BPF instruction format `libseccomp`
 * itself compiles down to — rather than shelling out to Python/libseccomp
 * at runtime, so this feature adds zero new dependency for end users.
 * Every syscall number below was cross-checked against libseccomp's own
 * resolver in this repo's dev environment (`python3 -c "import seccomp;
 * print(seccomp.resolve_syscall(seccomp.Arch(), name))"`), not just
 * recalled, and the resulting filter is proven end-to-end against the
 * real kernel (a real bwrap+seccomp sandboxed process, real raw syscalls,
 * real EPERM). arm64 has an entirely different syscall number table and
 * is honestly reported as unsupported rather than guessed at with no way
 * to verify it here.
 */

// --- Classic BPF (cBPF) instruction encoding — linux/filter.h / linux/bpf_common.h ---
interface BpfInstruction {
  code: number;
  jt: number;
  jf: number;
  k: number;
}

const BPF_LD = 0x00;
const BPF_W = 0x00;
const BPF_ABS = 0x20;
const BPF_JMP = 0x05;
const BPF_JEQ = 0x10;
const BPF_RET = 0x06;

function loadAbs(offset: number): BpfInstruction {
  return { code: BPF_LD | BPF_W | BPF_ABS, jt: 0, jf: 0, k: offset };
}
function jumpEq(k: number, jt: number, jf: number): BpfInstruction {
  return { code: BPF_JMP | BPF_JEQ, jt, jf, k };
}
function ret(k: number): BpfInstruction {
  return { code: BPF_RET, jt: 0, jf: 0, k };
}

// SECCOMP_RET_* actions — linux/seccomp.h
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO = 0x00050000;
const EPERM = 1;

// Offsets into `struct seccomp_data { int nr; __u32 arch; __u64 instruction_pointer; __u64 args[6]; }` — linux/seccomp.h.
const OFFSETOF_NR = 0;
const OFFSETOF_ARCH = 4;

// linux/audit.h: AUDIT_ARCH_X86_64 = EM_X86_64(62) | __AUDIT_ARCH_64BIT(0x80000000) | __AUDIT_ARCH_LE(0x40000000). The single most-cited constant in every public seccomp-filter dump/example for this architecture.
const AUDIT_ARCH_X86_64 = 0xc000003e;

/**
 * x86_64 syscall numbers for the denied set — each cross-checked against
 * libseccomp's resolver (see module doc comment), not recalled. Every
 * entry has a one-line reason a coding-agent's shell/build/test tooling
 * never legitimately needs it.
 */
export const DENIED_SYSCALLS_X86_64: Record<string, number> = {
  ptrace: 101, // process injection/debugging — a sandbox-escape and secret-extraction primitive
  mount: 165, // filesystem mount manipulation — namespace-escape primitive
  umount2: 166, // filesystem unmount — no legitimate dev-tool use
  pivot_root: 155, // changing the root filesystem — container-escape primitive
  reboot: 169, // system reboot — never needed by dev tooling
  kexec_load: 246, // loading a replacement kernel — severe, never needed
  kexec_file_load: 320, // same, file-based variant
  init_module: 175, // kernel module loading — severe, never needed
  finit_module: 313, // same, fd-based variant
  delete_module: 176, // kernel module removal — never needed
  acct: 163, // process accounting control — never needed
  swapon: 167, // swap management — never needed
  swapoff: 168, // same
  add_key: 248, // kernel keyring manipulation — no legitimate dev-tool use
  request_key: 249, // same
  keyctl: 250, // same
  bpf: 321, // loading BPF programs — privilege-escalation/exploit vector, no legitimate dev-tool use
  userfaultfd: 323, // userspace page-fault handling — a common kernel-exploit heap-spray primitive
  unshare: 272, // namespace manipulation — bwrap already unshares what's needed; blocking prevents nested tricks
  setns: 308, // joining another namespace — same reasoning as unshare
  open_by_handle_at: 304, // can bypass path-based access checks in some scenarios — no legitimate dev-tool use
  clock_settime: 227, // modifying the system clock — never needed by dev tooling
  settimeofday: 164 // same, legacy variant
};

export interface SeccompDetection {
  supported: boolean;
  reason: string;
}

export function detectSeccompSupport(platform: NodeJS.Platform = process.platform, arch: NodeJS.Architecture = process.arch): SeccompDetection {
  if (platform !== "linux") return { supported: false, reason: `seccomp layering is Linux-only (platform: "${platform}")` };
  if (arch !== "x64") {
    return {
      supported: false,
      reason: `only the x86_64 syscall table is implemented and verified for this filter; arch "${arch}" is not yet supported (§12.6 gap, not a silent skip)`
    };
  }
  return { supported: true, reason: "x86_64 seccomp-bpf filter available" };
}

/**
 * Assembles the filter: validate architecture, then deny each syscall in
 * `DENIED_SYSCALLS_X86_64` with EPERM, default-allow everything else.
 * Returns the raw `sock_filter` array bytes — exactly the format
 * `bwrap --seccomp FD` reads (the same format `libseccomp`'s
 * `seccomp_export_bpf()` produces, empirically confirmed against a real
 * `bwrap` process during development of this module).
 */
export function buildSeccompFilterX86_64(): Buffer {
  const denyNumbers = Object.values(DENIED_SYSCALLS_X86_64);
  const numChecks = denyNumbers.length;

  // Layout: [0] load arch, [1] arch check, [2] load nr, [3..3+numChecks) syscall checks, [3+numChecks] RET_ALLOW, [3+numChecks+1] RET_ERRNO.
  const errnoIndex = 3 + numChecks + 1;
  const instructions: BpfInstruction[] = [];

  instructions.push(loadAbs(OFFSETOF_ARCH));
  // If arch matches, fall through (jt=0) to the nr load next; otherwise jump straight to the ERRNO instruction — a wrong-architecture syscall_data is never a case this filter should evaluate normally.
  instructions.push(jumpEq(AUDIT_ARCH_X86_64, 0, errnoIndex - 2));
  instructions.push(loadAbs(OFFSETOF_NR));

  denyNumbers.forEach((nr, i) => {
    const checkIndex = 3 + i;
    // BPF jump offsets are relative to the instruction *after* the jump.
    const jt = errnoIndex - (checkIndex + 1);
    instructions.push(jumpEq(nr, jt, 0));
  });

  instructions.push(ret(SECCOMP_RET_ALLOW));
  instructions.push(ret(SECCOMP_RET_ERRNO | EPERM));

  const buf = Buffer.alloc(instructions.length * 8);
  instructions.forEach((instr, i) => {
    const off = i * 8;
    buf.writeUInt16LE(instr.code, off);
    buf.writeUInt8(instr.jt, off + 2);
    buf.writeUInt8(instr.jf, off + 3);
    buf.writeUInt32LE(instr.k >>> 0, off + 4);
  });
  return buf;
}

/**
 * Writes the compiled filter to a stable path under the OS temp dir and
 * returns it, generating it once (content is fully deterministic, so a
 * byte-identical existing file is left alone rather than rewritten every
 * call). Returns `undefined` when `detectSeccompSupport()` says this
 * platform/arch isn't supported — callers should skip seccomp layering
 * entirely in that case, not fall back to a partial filter.
 */
export function ensureSeccompFilterFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!detectSeccompSupport().supported) return undefined;
  const filterPath = path.join(env.TMPDIR ?? os.tmpdir(), "clutchcode-seccomp-x86_64.bpf");
  const filter = buildSeccompFilterX86_64();
  if (fs.existsSync(filterPath) && fs.readFileSync(filterPath).equals(filter)) return filterPath;
  fs.writeFileSync(filterPath, filter);
  return filterPath;
}
