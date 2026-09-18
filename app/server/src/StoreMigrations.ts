export interface VersionedDocument {
  schemaVersion: number;
}

export interface StoreMigration<T extends VersionedDocument> {
  fromVersion: number;
  migrate(document: T): T;
}

export function runMigrations<T extends VersionedDocument>(
  document: T,
  currentVersion: number,
  migrations: ReadonlyArray<StoreMigration<T>>
): T {
  let migrated = structuredClone(document);
  while (migrated.schemaVersion < currentVersion) {
    const step = migrations.find((candidate) => candidate.fromVersion === migrated.schemaVersion);
    if (!step) throw new Error(`No migration from schema version ${migrated.schemaVersion} to ${migrated.schemaVersion + 1}`);
    migrated = step.migrate(migrated);
    if (migrated.schemaVersion !== step.fromVersion + 1) {
      throw new Error(`Migration from schema version ${step.fromVersion} must produce version ${step.fromVersion + 1}`);
    }
  }
  return migrated;
}
