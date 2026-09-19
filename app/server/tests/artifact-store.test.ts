import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileArtifactStore } from "../src/ArtifactStore.js";

describe("FileArtifactStore", () => test("keeps every version without artifact content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aios-artifacts-"));
  try {
    const path = join(directory, "artifacts.json"); const first = new FileArtifactStore(path);
    first.save({ id: "one", workItemId: "work", stageKind: "plan", name: "plan.md", version: 1, approvalState: "draft", kind: "authored", branch: "work/one", filePath: "plan.md" });
    first.save({ id: "two", workItemId: "work", stageKind: "plan", name: "plan.md", version: 2, approvalState: "awaiting", kind: "authored", branch: "work/one", filePath: "plan.md" });
    expect(new FileArtifactStore(path).list("work", "plan")).toHaveLength(2);
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8"))).not.toContain("content");
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
