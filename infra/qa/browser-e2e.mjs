import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const webUrl = (process.env.WEB_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const reportFile = process.env.RELEASE_QA_REPORT ?? "release-browser-report.json";
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome ou Chromium não encontrado no runner.");

const profile = await mkdtemp(join(tmpdir(), "nova-aurora-chrome-"));
const child = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--window-size=1440,1000",
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

process.on("exit", () => {
  if (!child.killed) child.kill("SIGKILL");
  if (child.exitCode && stderr) console.error(stderr.slice(-4000));
});

async function retry(operation, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await operation(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError ?? new Error("Tempo limite excedido.");
}

const devToolsPortFile = join(profile, "DevToolsActivePort");
const cdpBaseUrl = await retry(async () => {
  if (child.exitCode !== null) {
    const detail = stderr.trim().slice(-2000);
    throw new Error(`Chrome encerrou antes do DevTools ficar disponível (exit=${child.exitCode}).${detail ? ` ${detail}` : ""}`);
  }
  const activePort = await readFile(devToolsPortFile, "utf8");
  const [portLine] = activePort.trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`DevToolsActivePort inválido: ${portLine ?? "vazio"}`);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const response = await fetch(`${baseUrl}/json/version`);
  if (!response.ok) throw new Error("Chrome DevTools ainda não respondeu.");
  return baseUrl;
}, 30_000);

const targetResponse = await fetch(
  `${cdpBaseUrl}/json/new?${encodeURIComponent(`${webUrl}/login`)}`,
  { method: "PUT" }
);
if (!targetResponse.ok) throw new Error(`Não foi possível criar aba CDP: ${targetResponse.status}.`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params?.exceptionDetails?.text ?? "Exceção JavaScript sem detalhe");
  }
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Falha no navegador.");
  return result.result?.value;
}

async function waitReady() {
  await retry(async () => {
    const ready = await evaluate("document.readyState");
    if (ready !== "complete") throw new Error("Documento ainda não terminou de carregar.");
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function navigate(path) {
  await command("Page.navigate", { url: `${webUrl}${path}` });
  await waitReady();
}

async function waitForHeading(selector, expected, context, timeoutMs = 15_000) {
  return retry(async () => {
    const state = await evaluate(`(() => ({
      text: document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || '',
      alert: document.querySelector('[role=alert]')?.textContent?.trim() || ''
    }))()`);
    if (state.alert) throw new Error(`${context} exibiu erro operacional: ${state.alert}`);
    if (!String(state.text).includes(expected)) {
      throw new Error(`${context} ainda não renderizou ${expected}. Atual: ${state.text || "vazio"}`);
    }
    return state;
  }, timeoutMs);
}

async function clickHubTab(label) {
  const clicked = await evaluate(`(() => {
    const navigation = document.querySelector('nav[aria-label="Áreas do hub social"]');
    if (!navigation) return false;
    const button = [...navigation.querySelectorAll('button')].find((node) =>
      (node.textContent || '').trim().startsWith(${JSON.stringify(label)})
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Aba ${label} não encontrada na navegação do Hub Social.`);
}

function auditExpression() {
  return `(() => {
    const issues = [];
    if (document.documentElement.lang !== 'pt-BR') issues.push('html sem lang pt-BR');
    if (document.querySelectorAll('main').length !== 1) issues.push('página deve possuir exatamente um main');
    if (document.querySelectorAll('h1').length !== 1) issues.push('página deve possuir exatamente um h1');
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    if (new Set(ids).size !== ids.length) issues.push('IDs duplicados');
    for (const input of document.querySelectorAll('input,textarea,select')) {
      const labelled = input.labels?.length || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      if (!labelled) issues.push('campo sem rótulo: ' + (input.name || input.type || input.tagName));
    }
    for (const node of document.querySelectorAll('button,a[href]')) {
      const name = (node.getAttribute('aria-label') || node.textContent || '').trim();
      if (!name) issues.push('controle sem nome acessível');
    }
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) issues.push('imagem sem alt');
    }
    return { title: document.title, path: location.pathname, issues };
  })()`;
}

const report = { pages: [], login: null, socialHub: null, creatorStudio: null, ugcStudio: null, exceptions };
await command("Page.enable");
await command("Runtime.enable");

for (const path of ["/login", "/verify-email", "/recover-account", "/trust"]) {
  await navigate(path);
  const audit = await evaluate(auditExpression());
  report.pages.push(audit);
  if (audit.path !== path) {
    throw new Error(`A rota pública ${path} redirecionou para ${audit.path}.`);
  }
}

await navigate("/login");
const submitted = await evaluate(`(() => {
  const email = document.querySelector('input[type=email]');
  const password = document.querySelector('input[type=password]');
  const form = document.querySelector('form');
  if (!email || !password || !form) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(email, ${JSON.stringify(process.env.E2E_EMAIL ?? "alice@nova-aurora.local")});
  email.dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(password, ${JSON.stringify(process.env.E2E_PASSWORD ?? "Aurora@2026")});
  password.dispatchEvent(new Event('input', { bubbles: true }));
  form.requestSubmit();
  return true;
})()`);
if (!submitted) throw new Error("Formulário de login não foi encontrado.");
await retry(async () => {
  const path = await evaluate("location.pathname");
  if (path === "/login") {
    const status = await evaluate("document.querySelector('[role=status]')?.textContent || ''");
    throw new Error(`Login ainda não concluiu: ${status}`);
  }
}, 20_000);
report.login = { path: await evaluate("location.pathname"), authenticated: true };

for (const path of [
  "/account",
  "/release",
  "/trust",
  "/feedback",
  "/beta-insights",
  "/community",
  "/community/social",
  "/community/social/studio",
  "/community/social/studio/ugc"
]) {
  await navigate(path);

  if (path === "/community/social") {
    await waitForHeading("h1", "Hub Social", "Hub Social");
  }
  if (path === "/community/social/studio") {
    await waitForHeading("h1", "Creator Studio", "Creator Studio");
    const readyState = await waitForHeading("h3", "Creator Studio", "Creator Studio · dados editoriais");
    report.creatorStudio = { path, heading: readyState.text, ready: true };
  }
  if (path === "/community/social/studio/ugc") {
    await waitForHeading("h1", "UGC Creator Studio", "UGC Creator Studio");
    const readyState = await waitForHeading("h3", "UGC Creator Studio", "UGC Creator Studio · dados de blueprint/edição/vendas");
    report.ugcStudio = { path, heading: readyState.text, ready: true };
  }

  const audit = await evaluate(auditExpression());
  report.pages.push(audit);
  if (audit.path !== path) {
    throw new Error(`A rota autenticada ${path} redirecionou para ${audit.path}.`);
  }
  if (path === "/release") {
    const heading = await evaluate("document.querySelector('h1')?.textContent || ''");
    if (!String(heading).includes("beta")) throw new Error("Central de release não renderizou.");
  }
  if (path === "/feedback") {
    const heading = await evaluate("document.querySelector('h1')?.textContent || ''");
    if (!String(heading).includes("Suporte")) {
      throw new Error("Central de feedback e suporte não renderizou.");
    }
  }
  if (path === "/beta-insights") {
    const heading = await evaluate("document.querySelector('h1')?.textContent || ''");
    const restricted = String(heading).includes("Aprendizado do beta");
    const operational = String(heading).includes("Aprender, responder e liberar");
    if (!restricted && !operational) {
      throw new Error("Central de suporte e rollout não renderizou.");
    }
  }
  if (path === "/community") {
    const heading = await evaluate("document.querySelector('h1')?.textContent || ''");
    if (!String(heading).includes("beta aprende em público")) {
      throw new Error("Central de comunicados não renderizou.");
    }
  }
  if (path === "/community/social") {
    const tabs = [
      ["Descobrir", "Descobrir a cidade criativa"],
      ["Atividade", "Activity Inbox"],
      ["Mensagens", "Mensagens privadas"],
      ["Meu impacto", "Meu impacto em 30 dias"],
      ["Segurança", "Contas bloqueadas"]
    ];
    const tabEvidence = [];
    for (const [label, expectedHeading] of tabs) {
      await clickHubTab(label);
      const state = await waitForHeading("h2", expectedHeading, `Hub Social · ${label}`);
      tabEvidence.push({ label, heading: state.text });
    }
    report.socialHub = { path, tabs: tabEvidence };
  }
}

// Aguarda efeitos, chamadas assíncronas e exceções tardias antes de congelar a evidência.
await new Promise((resolve) => setTimeout(resolve, 1_000));
const issues = report.pages.flatMap((page) => page.issues.map((issue) => `${page.path}: ${issue}`));
const finalReport = { ...report, exceptions: [...exceptions], issues };
await writeFile(reportFile, JSON.stringify(finalReport, null, 2));
if (issues.length > 0) throw new Error(`Falhas de acessibilidade: ${issues.join("; ")}`);
if (exceptions.length > 0) throw new Error(`Exceções no navegador: ${exceptions.join("; ")}`);

socket.close();
child.kill("SIGTERM");
await Promise.race([
  new Promise((resolve) => child.once("exit", resolve)),
  new Promise((resolve) => setTimeout(resolve, 3_000))
]);
if (child.exitCode === null) {
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}
await retry(async () => {
  await rm(profile, { recursive: true, force: true });
}, 5_000);
console.log(JSON.stringify({
  status: "passed",
  pages: report.pages.length,
  socialHubTabs: report.socialHub?.tabs.length ?? 0,
  creatorStudioReady: report.creatorStudio?.ready ?? false,
  ugcStudioReady: report.ugcStudio?.ready ?? false,
  signature: "Tehkné Solutions"
}));
