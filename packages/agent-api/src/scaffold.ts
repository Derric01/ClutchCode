import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, configPath, saveConfig } from "./config.js";

const AGENTS_MD_TEMPLATE = `# AGENTS.md

This file is read by ClutchCode (and other AGENTS.md-aware tools) before
working on this repository (PROJECT_SPEC.md §10.1). It is the
single most cost-effective context input for a weak/local model — a good
AGENTS.md is worth more than a bigger model.

## Build / test / lint commands

<!-- ClutchCode auto-detects these from your manifest (package.json, pyproject.toml, Cargo.toml, go.mod).
     Override any of them explicitly here — human edits always win:
- build: \`npm run build\`
- test: \`npm test\`
- lint: \`npm run lint\`
-->

## Conventions

- (describe directory layout, style rules, and any "don't touch" areas)

## Domain glossary

- (terms a newcomer — human or model — would need explained)
`;

export interface InitResult {
  configCreated: boolean;
  agentsMdCreated: boolean;
}

/** `agent init` (§18.2): scaffold config + AGENTS.md in a repo. Never overwrites an existing file. */
export function initRepo(repoPath: string): InitResult {
  fs.mkdirSync(repoPath, { recursive: true });

  let configCreated = false;
  if (!fs.existsSync(configPath(repoPath))) {
    saveConfig(repoPath, DEFAULT_CONFIG);
    configCreated = true;
  }

  let agentsMdCreated = false;
  const agentsMdPath = path.join(repoPath, "AGENTS.md");
  if (!fs.existsSync(agentsMdPath)) {
    fs.writeFileSync(agentsMdPath, AGENTS_MD_TEMPLATE, "utf8");
    agentsMdCreated = true;
  }

  return { configCreated, agentsMdCreated };
}
