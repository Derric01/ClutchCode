import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * §5.1 tier 2: the encrypted file store fallback for machines with no OS
 * keychain at all (headless Linux with no Secret Service, some Profile-D
 * servers) — `~/.config/clutchcode/credentials.age`.
 *
 * **Scoping decision, stated plainly:** the spec names the path/extension
 * `.age` after the `age` encryption tool, but this implementation does
 * not produce byte-compatible `age`-format files — it uses Node's
 * built-in `crypto` (scrypt key derivation + AES-256-GCM authenticated
 * encryption), which is a real, correct, dependency-free primitive
 * rather than a from-scratch reimplementation of the `age` wire format
 * (recipient stanzas, HKDF, ChaCha20-Poly1305) that a clean-room build
 * would need to get exactly right to matter. The `.age` filename is kept
 * because the spec names it; the format inside is documented here rather
 * than silently assumed to be `age`-compatible.
 *
 * **The "machine-bound secret"** is 32 random bytes generated once and
 * persisted at `machine.key` alongside the credential file, with
 * owner-only (`0600`) permissions. This is *not* hardware-backed — no
 * TPM, no Secure Enclave, no platform attestation — an honest scoping
 * decision, not a silent gap: it still raises the bar over a plaintext
 * credentials file, since an attacker needs both files (neither alone
 * decrypts anything), without depending on hardware this environment has
 * no way to verify either way. An optional passphrase can be layered on
 * top for a user who wants more than file-permission protection.
 *
 * Every read is best-effort and silent on failure by construction — a
 * missing file, a wrong passphrase, or a corrupted/tampered ciphertext
 * (the AES-GCM auth tag catches tampering) all just come back as "not
 * found," never a thrown error, matching the same fail-closed contract
 * `keychain-linux.ts` documents for tier 1.
 */

export interface FileStoreOptions {
  /** Override for `~/.config/clutchcode` — real usage never sets this; tests point it at a temp dir. */
  configDir?: string;
  /** Extra secret mixed into key derivation, on top of the machine key file. Optional; omitted entirely for non-interactive/scripted use. Never persisted anywhere. */
  passphrase?: string;
}

const ENVELOPE_VERSION = 1;

interface EncryptedEnvelope {
  version: typeof ENVELOPE_VERSION;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

type StoredAccounts = Record<string, string>;

export function defaultCredentialConfigDir(): string {
  return path.join(os.homedir(), ".config", "clutchcode");
}

function resolveConfigDir(opts?: FileStoreOptions): string {
  return opts?.configDir ?? defaultCredentialConfigDir();
}

function machineKeyPath(configDir: string): string {
  return path.join(configDir, "machine.key");
}

export function credentialFilePath(configDir: string = defaultCredentialConfigDir()): string {
  return path.join(configDir, "credentials.age");
}

function ensureMachineKey(configDir: string): Buffer {
  const p = machineKeyPath(configDir);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  fs.mkdirSync(configDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(p, key, { mode: 0o600 });
  fs.chmodSync(p, 0o600); // belt-and-suspenders: writeFileSync's mode is subject to umask
  return key;
}

function deriveKey(machineKey: Buffer, passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(Buffer.concat([machineKey, Buffer.from(passphrase, "utf8")]), salt, 32);
}

function encrypt(plaintext: string, machineKey: Buffer, passphrase: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(machineKey, passphrase, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: ENVELOPE_VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex")
  };
}

function decrypt(envelope: EncryptedEnvelope, machineKey: Buffer, passphrase: string): string | undefined {
  try {
    const key = deriveKey(machineKey, passphrase, Buffer.from(envelope.salt, "hex"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "hex"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "hex"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "hex")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong passphrase, corrupted file, or a tampered auth tag — all
    // indistinguishable from "can't read it" by design; never a crash.
    return undefined;
  }
}

function readStore(configDir: string, machineKey: Buffer, passphrase: string): StoredAccounts {
  const p = credentialFilePath(configDir);
  if (!fs.existsSync(p)) return {};
  try {
    const envelope = JSON.parse(fs.readFileSync(p, "utf8")) as EncryptedEnvelope;
    const plaintext = decrypt(envelope, machineKey, passphrase);
    if (plaintext === undefined) return {};
    return JSON.parse(plaintext) as StoredAccounts;
  } catch {
    return {};
  }
}

function writeStore(configDir: string, accounts: StoredAccounts, machineKey: Buffer, passphrase: string): void {
  fs.mkdirSync(configDir, { recursive: true });
  const envelope = encrypt(JSON.stringify(accounts), machineKey, passphrase);
  fs.writeFileSync(credentialFilePath(configDir), JSON.stringify(envelope), { mode: 0o600 });
}

export function fileStoreGet(account: string, opts?: FileStoreOptions): string | undefined {
  const configDir = resolveConfigDir(opts);
  if (!fs.existsSync(credentialFilePath(configDir))) return undefined;
  const machineKey = ensureMachineKey(configDir);
  const accounts = readStore(configDir, machineKey, opts?.passphrase ?? "");
  return accounts[account];
}

export function fileStoreSet(account: string, value: string, opts?: FileStoreOptions): boolean {
  try {
    const configDir = resolveConfigDir(opts);
    const machineKey = ensureMachineKey(configDir);
    const accounts = readStore(configDir, machineKey, opts?.passphrase ?? "");
    accounts[account] = value;
    writeStore(configDir, accounts, machineKey, opts?.passphrase ?? "");
    return true;
  } catch {
    return false;
  }
}

/** Returns `false` (not an error) when the account wasn't present — mirrors "nothing to remove" semantics used elsewhere in this codebase's credential commands. */
export function fileStoreClear(account: string, opts?: FileStoreOptions): boolean {
  try {
    const configDir = resolveConfigDir(opts);
    if (!fs.existsSync(credentialFilePath(configDir))) return false;
    const machineKey = ensureMachineKey(configDir);
    const accounts = readStore(configDir, machineKey, opts?.passphrase ?? "");
    if (!(account in accounts)) return false;
    delete accounts[account];
    writeStore(configDir, accounts, machineKey, opts?.passphrase ?? "");
    return true;
  } catch {
    return false;
  }
}
