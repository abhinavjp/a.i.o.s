import type { SpawnOptions } from "node:child_process";
import type { NativeExecution, NativeProcessResult, NativeProcessRunnerPort } from "../../src/native/NativeProcessRunner.js";

export class FakeNativeProcessRunner implements NativeProcessRunnerPort {
  readonly calls: Array<{ executable: string; argv: string[]; options?: SpawnOptions }> = [];
  cancelled = 0;
  readonly checks: Array<{ executable: string; argv: string[] }> = [];
  constructor(private readonly lines: string[] = [], private readonly sessionId = "native-session", private readonly checkResult: (argv: string[]) => boolean = () => true) {}
  spawn(executable: string, argv: string[], options?: SpawnOptions): NativeExecution {
    this.calls.push({ executable, argv: [...argv], options });
    const owner = this;
    return {
      lines: (async function* () { for (const line of owner.lines) yield line; })(),
      result: Promise.resolve<NativeProcessResult>({ output: "final output", nativeSessionId: this.sessionId }),
      cancel: () => { this.cancelled += 1; }
    };
  }
  async check(executable: string, argv: string[]): Promise<boolean> {
    this.checks.push({ executable, argv: [...argv] });
    return this.checkResult(argv);
  }
}
