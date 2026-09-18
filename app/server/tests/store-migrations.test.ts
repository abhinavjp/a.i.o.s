import { describe, expect, test } from "vitest";
import { runMigrations, type VersionedDocument } from "../src/StoreMigrations.js";

describe("store migrations", () => {
  test("runs ordered one-version steps to the current schema", () => {
    const calls: number[] = [];
    const document: VersionedDocument & { values: string[] } = { schemaVersion: 1, values: [] };

    const migrated = runMigrations(document, 3, [
      { fromVersion: 1, migrate: (value) => { calls.push(1); return { ...value, schemaVersion: 2, values: [...value.values, "one"] }; } },
      { fromVersion: 2, migrate: (value) => { calls.push(2); return { ...value, schemaVersion: 3, values: [...value.values, "two"] }; } }
    ]);

    expect(calls).toEqual([1, 2]);
    expect(migrated).toEqual({ schemaVersion: 3, values: ["one", "two"] });
  });

  test("leaves the caller document unchanged when a step throws", () => {
    const document = { schemaVersion: 1, values: ["original"] };

    expect(() => runMigrations(document, 2, [{ fromVersion: 1, migrate: () => { throw new Error("migration failed"); } }])).toThrow("migration failed");
    expect(document).toEqual({ schemaVersion: 1, values: ["original"] });
  });

  test("does not modify a current document", () => {
    const document = { schemaVersion: 1, values: ["current"] };

    expect(runMigrations(document, 1, [])).toEqual(document);
  });
});
