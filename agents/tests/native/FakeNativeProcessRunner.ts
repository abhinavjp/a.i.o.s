import type { NativeExecution, NativeProcessResult, NativeProcessRunnerPort } from "../../src/native/NativeProcessRunner.js";

export class FakeNativeProcessRunner implements NativeProcessRunnerPort {
  readonly calls: Array<{ executable: string; argv: string[] }> = [];
  cancelled = 0;
  constructor(private readonly lines: string[] = [], private readonly sessionId = "native-session") {}
  spawn(executable: string, argv: string[]): NativeExecution {
    this.calls.push({ executable, argv: [...argv] });
    const owner = this;
    return {
      lines: (async function* () { for (const line of owner.lines) yield line; })(),
      result: Promise.resolve<NativeProcessResult>({ output: "final output", nativeSessionId: this.sessionId }),
      cancel: () => { this.cancelled += 1; }
    };
  }
  async check(): Promise<boolean> { return true; }
}
