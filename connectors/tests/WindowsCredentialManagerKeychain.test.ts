import { randomUUID } from "node:crypto";
import { test, expect } from "vitest";
import { WindowsCredentialManagerKeychain } from "../src/index.js";

test.skipIf(process.platform !== "win32")("a missing Windows credential returns no value", async () => {
  const keychain = new WindowsCredentialManagerKeychain();
  await expect(keychain.read(`AIOS_MISSING_${randomUUID()}`)).resolves.toBeNull();
});
