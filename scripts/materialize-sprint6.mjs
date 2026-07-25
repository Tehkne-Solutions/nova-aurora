import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const bootstrap = path.join(root, ".sprint6-bootstrap");
const parts = fs.readdirSync(bootstrap)
  .filter((name) => name.endsWith(".b64"))
  .sort()
  .map((name) => fs.readFileSync(path.join(bootstrap, name), "utf8").trim())
  .join("");

const archive = path.join(bootstrap, "payload.zip");
fs.writeFileSync(archive, Buffer.from(parts, "base64"));
execFileSync("python3", ["-c", `
import zipfile
with zipfile.ZipFile(r"${archive}") as source:
    source.extractall(r"${root}")
`], { stdio: "inherit" });

fs.writeFileSync(
  path.join(root, ".github", "workflows", "ci.yml"),
  "name: CI\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    services:\n      postgres:\n        image: postgres:17-alpine\n        env:\n          POSTGRES_DB: nova_aurora\n          POSTGRES_USER: nova_aurora\n          POSTGRES_PASSWORD: nova_aurora\n        ports: [\"5432:5432\"]\n        options: >-\n          --health-cmd \"pg_isready -U nova_aurora -d nova_aurora\"\n          --health-interval 5s --health-timeout 5s --health-retries 10\n      redis:\n        image: redis:8-alpine\n        ports: [\"6379:6379\"]\n        options: >-\n          --health-cmd \"redis-cli ping\"\n          --health-interval 5s --health-timeout 5s --health-retries 10\n    env:\n      DATABASE_URL: postgresql://nova_aurora:nova_aurora@localhost:5432/nova_aurora\n      REDIS_URL: redis://localhost:6379\n      AUTH_SECRET: 12345678901234567890123456789012\n      INTERNAL_API_TOKEN: 123456789012345678901234\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n        with: { version: 10.13.1 }\n      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: pnpm install --no-frozen-lockfile\n      - run: pnpm db:migrate\n      - name: Typecheck\n        shell: bash\n        run: |\n          set -o pipefail\n          pnpm typecheck 2>&1 | tee typecheck.log\n      - name: Upload typecheck diagnostics\n        if: failure()\n        uses: actions/upload-artifact@v4\n        with:\n          name: typecheck-diagnostics\n          path: typecheck.log\n      - name: Test\n        shell: bash\n        run: |\n          set -o pipefail\n          pnpm test 2>&1 | tee test.log\n      - name: Upload test diagnostics\n        if: failure()\n        uses: actions/upload-artifact@v4\n        with:\n          name: test-diagnostics\n          path: test.log\n      - run: pnpm build\n"
);
fs.rmSync(bootstrap, { recursive: true, force: true });
fs.rmSync(path.join(root, "scripts", "materialize-sprint6.mjs"), { force: true });
console.log("Sprint 6 materializada.");
