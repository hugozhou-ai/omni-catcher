import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

export function createNativeCliFixture(dir) {
  if (process.platform !== "win32") {
    const command = path.join(dir, "tutti");
    writeFileSync(
      command,
      `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.TUTTI_TEST_ARGS_PATH, process.argv.slice(2).join("\\n"));\nprocess.stdout.write(process.env.TUTTI_TEST_PAYLOAD || "{}");\n`,
    );
    chmodSync(command, 0o755);
    return command;
  }

  const sourcePath = path.join(dir, "fixture.cs");
  const scriptPath = path.join(dir, "compile.ps1");
  const command = path.join(dir, "tutti.exe");
  writeFileSync(
    sourcePath,
    'using System; using System.IO; public class Program { public static void Main(string[] args) { File.WriteAllText(Environment.GetEnvironmentVariable("TUTTI_TEST_ARGS_PATH"), String.Join("\\n", args)); Console.Write(Environment.GetEnvironmentVariable("TUTTI_TEST_PAYLOAD") ?? "{}"); } }',
  );
  writeFileSync(
    scriptPath,
    'param([string]$Source, [string]$Output)\nAdd-Type -TypeDefinition (Get-Content -Raw -LiteralPath $Source) -Language CSharp -OutputAssembly $Output -OutputType ConsoleApplication\n',
  );
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    scriptPath,
    sourcePath,
    command,
  ]);
  return command;
}
