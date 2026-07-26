import { spawn } from "node:child_process";
import { loadRuntimeSecrets } from "./runtime-secrets.mjs";

await loadRuntimeSecrets();

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Comando do serviço não informado.");

const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    service: "runtime-bootstrap",
    event: "service.spawn.failed",
    message: error.message,
    signature: "Tehkné Solutions"
  }));
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
