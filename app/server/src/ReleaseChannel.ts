import { randomUUID, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { runMigrations, type StoreMigration } from "./StoreMigrations.js";

export const DEFAULT_RELEASE_CHANNEL = { channel: "public", url: "https://releases.adhisthana.dev/channel.json" };
export const DEFAULT_RELEASE_CHANNEL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfWgvK9KZU3fKJeZR7AwNO/J/14dGAG223ms30u6SrOk=
-----END PUBLIC KEY-----`;

export interface Release {
  version: string;
  download: string;
  checksum: string;
  notes: string;
}

export interface ReleaseChannelConfiguration {
  channel: string;
  url: string;
}

export interface ReleaseChannelStore {
  get(): ReleaseChannelConfiguration;
  set(configuration: ReleaseChannelConfiguration): ReleaseChannelConfiguration;
}

interface ReleaseChannelDocument {
  schemaVersion: number;
  configuration: ReleaseChannelConfiguration;
}

const RELEASE_CHANNEL_SCHEMA_VERSION = 1;
const RELEASE_CHANNEL_MIGRATIONS: ReadonlyArray<StoreMigration<ReleaseChannelDocument>> = [{
  fromVersion: 0,
  migrate: (document) => ({ schemaVersion: 1, configuration: document.configuration })
}];

export class MemoryReleaseChannelStore implements ReleaseChannelStore {
  constructor(private configuration: ReleaseChannelConfiguration = DEFAULT_RELEASE_CHANNEL) {}

  get() { return { ...this.configuration }; }

  set(configuration: ReleaseChannelConfiguration) {
    this.configuration = validateConfiguration(configuration);
    return this.get();
  }
}

export class FileReleaseChannelStore implements ReleaseChannelStore {
  private configuration: ReleaseChannelConfiguration;
  private migratedOnOpen = false;

  constructor(private readonly filePath: string) {
    this.configuration = this.load();
    if (this.migratedOnOpen) this.persist();
  }

  get() { return { ...this.configuration }; }

  set(configuration: ReleaseChannelConfiguration) {
    this.configuration = validateConfiguration(configuration);
    this.persist();
    return this.get();
  }

  private load(): ReleaseChannelConfiguration {
    if (!existsSync(this.filePath)) return { ...DEFAULT_RELEASE_CHANNEL };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<ReleaseChannelDocument> & Partial<ReleaseChannelConfiguration>;
    const schemaVersion = parsed.schemaVersion ?? 0;
    if (!Number.isInteger(schemaVersion)) throw new Error(`Invalid release channel schema version: ${this.filePath}`);
    if (schemaVersion > RELEASE_CHANNEL_SCHEMA_VERSION) throw new Error(`Release channel schema version ${schemaVersion} is newer than supported version ${RELEASE_CHANNEL_SCHEMA_VERSION}`);
    const configuration = parsed.configuration ?? { channel: parsed.channel, url: parsed.url };
    const document = runMigrations({ schemaVersion, configuration } as ReleaseChannelDocument, RELEASE_CHANNEL_SCHEMA_VERSION, RELEASE_CHANNEL_MIGRATIONS);
    this.migratedOnOpen = schemaVersion < RELEASE_CHANNEL_SCHEMA_VERSION;
    return validateConfiguration(document.configuration);
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: RELEASE_CHANNEL_SCHEMA_VERSION, configuration: this.configuration }, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}

export interface ReleaseChannelTransport {
  fetch(url: string, metadata: { version: string; channel: string }): Promise<string>;
}

export class FetchReleaseChannelTransport implements ReleaseChannelTransport {
  async fetch(url: string, metadata: { version: string; channel: string }) {
    const endpoint = new URL(url);
    const request = endpoint.protocol === "https:" ? httpsRequest : endpoint.protocol === "http:" ? httpRequest : undefined;
    if (!request) throw new Error("release channel URL must use HTTP or HTTPS");
    return new Promise<string>((resolve, reject) => {
      const check = request(endpoint, { method: "GET", headers: { "x-adhisthana-version": metadata.version, "x-adhisthana-channel": metadata.channel } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) reject(new Error(`release channel returned ${response.statusCode}`));
          else resolve(Buffer.concat(chunks).toString("utf8"));
        });
      });
      check.on("error", reject);
      check.end();
    });
  }
}

export type ReleaseChannelCheck =
  | { status: "available"; release: Release }
  | { status: "current" }
  | { status: "failed"; error: string };

interface SignedReleaseManifest {
  channel: string;
  releases: Release[];
  signature?: string;
}

export class ReleaseChannelManager {
  constructor(
    private readonly store: ReleaseChannelStore,
    private readonly transport: ReleaseChannelTransport,
    private readonly runningVersion: string,
    private readonly publicKey: string
  ) {}

  configuration() { return this.store.get(); }

  configure(configuration: ReleaseChannelConfiguration) { return this.store.set(configuration); }

  async check(configuration = this.configuration()): Promise<ReleaseChannelCheck> {
    try {
      const manifest = JSON.parse(await this.transport.fetch(configuration.url, { version: this.runningVersion, channel: configuration.channel })) as SignedReleaseManifest;
      if (!manifest.signature) return { status: "failed", error: "release channel signature is missing" };
      if (!isManifest(manifest) || manifest.channel !== configuration.channel || !verify(null, Buffer.from(JSON.stringify({ channel: manifest.channel, releases: manifest.releases })), this.publicKey, Buffer.from(manifest.signature, "base64"))) {
        return { status: "failed", error: "release channel signature is invalid" };
      }
      const release = manifest.releases.filter((candidate) => compareVersions(candidate.version, this.runningVersion) > 0).sort((left, right) => compareVersions(right.version, left.version))[0];
      return release ? { status: "available", release } : { status: "current" };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "release channel check failed" };
    }
  }
}

function validateConfiguration(configuration: ReleaseChannelConfiguration): ReleaseChannelConfiguration {
  if (!configuration || typeof configuration.channel !== "string" || !configuration.channel.trim() || typeof configuration.url !== "string" || !/^https?:\/\//.test(configuration.url)) throw new Error("release channel configuration is invalid");
  return { channel: configuration.channel.trim(), url: configuration.url };
}

function isManifest(manifest: SignedReleaseManifest): manifest is SignedReleaseManifest & { signature: string } {
  return typeof manifest.channel === "string" && manifest.channel.trim().length > 0 && Array.isArray(manifest.releases) && manifest.releases.every((release) => /^\d+(?:\.\d+)*$/.test(release.version) && typeof release.download === "string" && release.download.trim().length > 0 && typeof release.checksum === "string" && release.checksum.trim().length > 0 && typeof release.notes === "string" && release.notes.trim().length > 0);
}

function compareVersions(left: string, right: string): number {
  const parse = (version: string) => /^\d+(?:\.\d+)*$/.test(version) ? version.split(".").map(Number) : undefined;
  const leftParts = parse(left); const rightParts = parse(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
