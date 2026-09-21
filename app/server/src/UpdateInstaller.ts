import { createHash } from "node:crypto";
import type { SarathiStore } from "./sarathi/SarathiStore.js";

export interface UpdateInstaller { download(location: string): Promise<Buffer>; install(input: { version: string; artifact: Buffer; retainPrevious: true }): Promise<void>; }

export class NullUpdateInstaller implements UpdateInstaller {
  async download(): Promise<Buffer> { throw new Error("system update execution is not configured"); }
  async install(): Promise<void> { throw new Error("system update execution is not configured"); }
}

export class UpdateInstallerConfigurator {
  private readonly installers = new Map<string, UpdateInstaller>([["fallback", new NullUpdateInstaller()]]);
  register(name: string, installer: UpdateInstaller): void { this.installers.set(name, installer); }
  select(name = "default"): UpdateInstaller { return this.installers.get(name) ?? this.installers.get("fallback")!; }
}

export class UpdateManager {
  constructor(private readonly installer: UpdateInstaller, private readonly store: SarathiStore) {}
  async apply(context: Record<string, string>): Promise<void> {
    const artifact = await this.installer.download(context.download);
    if (createHash("sha256").update(artifact).digest("hex") !== context.checksum) throw new Error("update checksum does not match");
    await this.installer.install({ version: context.version, artifact, retainPrevious: true });
    this.store.recordUpdateAudit({ version: context.version, channel: context.channel, appliedAt: new Date().toISOString() });
  }
}
