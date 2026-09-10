import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type {
  AgentEngineKind,
  EngineConsent,
  EnginePolicyOverride,
  EnginePolicySource
} from "@aios/contracts";

export interface StoredEnginePolicy extends EnginePolicyOverride {
  version: number;
}

export interface EngineConfigDocument {
  version: 1;
  global: StoredEnginePolicy;
  workflows: Record<string, StoredEnginePolicy>;
  agents: Record<string, StoredEnginePolicy>;
  consent: EngineConsent;
}

export interface EngineConfigStore {
  snapshot(): EngineConfigDocument;
  getPolicy(source: EnginePolicySource, id?: string): StoredEnginePolicy | null;
  setPolicy(source: Exclude<EnginePolicySource, "task">, id: string | undefined, policy: EnginePolicyOverride): StoredEnginePolicy;
  setConsent(consent: EngineConsent): EngineConsent;
}

const ENGINES: AgentEngineKind[] = ["hermes", "codex", "claude-code"];
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_KEY = /apikey|token|secret|password/i;

export class FileEngineConfigStore implements EngineConfigStore {
  private document: EngineConfigDocument;

  constructor(private readonly filePath: string) {
    this.document = this.load();
  }

  snapshot(): EngineConfigDocument {
    return clone(this.document);
  }

  getPolicy(source: EnginePolicySource, id?: string): StoredEnginePolicy | null {
    const value = source === "global" ? this.document.global : source === "workflow" ? this.document.workflows[id ?? ""] : source === "agent" ? this.document.agents[id ?? ""] : null;
    return value ? clone(value) : null;
  }

  setPolicy(source: Exclude<EnginePolicySource, "task">, id: string | undefined, policy: EnginePolicyOverride): StoredEnginePolicy {
    if (source !== "global" && !id?.trim()) throw new Error(`${source} id is required`);
    validatePolicy(policy);
    if (policy.fallbackEnabled && !this.document.consent.crossEngineFallback) throw new Error("cross-engine fallback requires explicit consent");
    const current = this.getPolicy(source, id);
    const next: StoredEnginePolicy = { ...clone(policy), version: (current?.version ?? 0) + 1 };
    if (source === "global") this.document.global = next;
    else if (source === "workflow") this.document.workflows[id!] = next;
    else this.document.agents[id!] = next;
    this.persist();
    return clone(next);
  }

  setConsent(consent: EngineConsent): EngineConsent {
    if (typeof consent.crossEngineFallback !== "boolean" || typeof consent.paidFallback !== "boolean") {
      throw new Error("fallback consent flags must be boolean");
    }
    this.document.consent = { ...consent };
    this.persist();
    return { ...this.document.consent };
  }

  private load(): EngineConfigDocument {
    if (!existsSync(this.filePath)) {
      const migrated = defaultDocument();
      this.document = migrated;
      this.persist();
      return migrated;
    }
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!isDocument(parsed)) throw new Error(`Invalid engine config document: ${this.filePath}`);
    const migrated = migrateDocument(parsed);
    validatePolicy(migrated.global);
    for (const policy of Object.values(migrated.workflows)) validatePolicy(policy);
    for (const policy of Object.values(migrated.agents)) validatePolicy(policy);
    this.document = migrated;
    this.persist();
    return migrated;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.document, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}

export function validatePolicy(policy: EnginePolicyOverride): void {
  rejectSecrets(policy);
  if (policy.primary) {
    if (!ENGINES.includes(policy.primary.engine as AgentEngineKind)) throw new Error("unknown engine");
    if (typeof policy.primary.configuration !== "string" || !policy.primary.configuration.trim()) throw new Error("configuration is required");
    if (policy.primary.credentialEnv !== undefined && !ENV_NAME.test(policy.primary.credentialEnv)) throw new Error("credentialEnv must be an environment-variable name");
    if (policy.primary.billingMode !== undefined && !["subscription", "api", "local"].includes(policy.primary.billingMode)) throw new Error("unknown billing mode");
  }
  for (const route of policy.fallbacks ?? []) validatePolicy({ primary: route });
  if (policy.fallbackEnabled !== undefined && typeof policy.fallbackEnabled !== "boolean") throw new Error("fallbackEnabled must be boolean");
}

function rejectSecrets(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`secret field is not accepted: ${key}`);
    rejectSecrets(child);
  }
}

function defaultDocument(): EngineConfigDocument {
  return {
    version: 1,
    global: { version: 1, primary: { engine: "hermes", configuration: "default", billingMode: "subscription" }, fallbacks: [], fallbackEnabled: false },
    workflows: {},
    agents: {},
    consent: { crossEngineFallback: false, paidFallback: false, acceptedAt: null }
  };
}

function isDocument(value: unknown): value is EngineConfigDocument {
  const candidate = value as { version?: unknown; global?: unknown } | null;
  return !!candidate && typeof candidate === "object" && candidate.version === 1 && !!candidate.global && typeof candidate.global === "object";
}

function migrateDocument(value: EngineConfigDocument): EngineConfigDocument {
  const { version: globalVersion = 1, ...globalPolicy } = value.global;
  const workflows = Object.fromEntries(Object.entries(value.workflows ?? {}).map(([key, item]) => {
    const { version = 1, ...policy } = item;
    return [key, { version, ...policy }];
  }));
  const agents = Object.fromEntries(Object.entries(value.agents ?? {}).map(([key, item]) => {
    const { version = 1, ...policy } = item;
    return [key, { version, ...policy }];
  }));
  return {
    version: 1,
    global: { version: globalVersion, ...globalPolicy },
    workflows,
    agents,
    consent: value.consent ? { ...value.consent } : { crossEngineFallback: false, paidFallback: false, acceptedAt: null }
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
