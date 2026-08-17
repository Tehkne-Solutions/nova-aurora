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

async function waitForAuthenticatedSurface(label, context, timeoutMs = 20_000) {
  return retry(async () => {
    const state = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(`[aria-label="${label}"][data-authenticated="true"]`)});
      return {
        found: Boolean(node),
        text: node?.textContent?.trim() || '',
        live: document.querySelector('[aria-live=polite]')?.textContent?.trim() || ''
      };
    })()`);
    if (!state.found) throw new Error(`${context} ainda não materializou a superfície autenticada.`);
    if (/inválida|expirada|obrigatória|indisponível|falhou/i.test(String(state.text))) {
      throw new Error(`${context} exibiu falha de autenticação/operação: ${state.text}`);
    }
    return state;
  }, timeoutMs);
}

async function waitForWorldEconomy(timeoutMs = 20_000) {
  return retry(async () => {
    const state = await evaluate(`(() => {
      const world = document.querySelector('[aria-label="Mundo econômico autenticado de Nova Aurora"][data-authenticated="true"]');
      const economy = document.querySelector('[aria-label="Economia local de Nova Aurora"]');
      const businesses = document.querySelector('[aria-label="Empresas locais de Nova Aurora"]');
      return {
        found: Boolean(world),
        location: world?.getAttribute('data-world-location') || '',
        localBusinessCount: world?.getAttribute('data-local-businesses-count') || '',
        worldText: world?.textContent?.trim() || '',
        economyText: economy?.textContent?.trim() || '',
        businessPanelFound: Boolean(businesses),
        businessText: businesses?.textContent?.trim() || ''
      };
    })()`);
    if (!state.found) throw new Error("Mundo econômico autenticado ainda não foi materializado.");
    if (!state.location) throw new Error("Localização econômica atual não foi materializada.");
    if (!/^\d+$/.test(String(state.localBusinessCount))) {
      throw new Error(`Contagem de empresas locais inválida: ${state.localBusinessCount || "vazia"}.`);
    }
    if (!String(state.economyText).includes("Economia local:")) {
      throw new Error("Contexto econômico local ainda não foi materializado.");
    }
    if (!state.businessPanelFound || !String(state.businessText).includes("EMPRESAS NESTE LOCAL")) {
      throw new Error("Painel de empresas locais ainda não foi materializado.");
    }
    if (/alice@nova-aurora\.local|bob@nova-aurora\.local|Simular compra de Bob/i.test(String(state.worldText))) {
      throw new Error("Mundo econômico ainda contém identidade ou compra demo.");
    }
    return state;
  }, timeoutMs);
}

async function waitForMarketProductionConsole(timeoutMs = 20_000) {
  return retry(async () => {
    const state = await evaluate(`(() => {
      const node = document.querySelector('[aria-label="Console autenticada de mercado e produção de Nova Aurora"][data-authenticated="true"]');
      const selects = node ? [...node.querySelectorAll('select')] : [];
      return {
        found: Boolean(node),
        refreshMs: node?.getAttribute('data-live-refresh-ms') || '',
        text: node?.textContent?.trim() || '',
        itemOptions: selects[0]?.options?.length || 0,
        recipeOptions: selects[2]?.options?.length || 0
      };
    })()`);
    if (!state.found) throw new Error("Console de mercado e produção ainda não foi montada.");
    if (state.refreshMs !== "5000") throw new Error(`Refresh econômico inesperado: ${state.refreshMs || "vazio"}.`);
    if (!String(state.text).includes("Saldo disponível")) throw new Error("Saldo disponível ainda não foi materializado.");
    if (state.itemOptions < 1) throw new Error("Catálogo de bens ainda não foi materializado.");
    if (state.recipeOptions < 1) throw new Error("Catálogo de receitas ainda não foi materializado.");
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

const report = {
  pages: [],
  login: null,
  socialHub: null,
  creatorStudio: null,
  ugcStudio: null,
  economySurfaces: null,
  exceptions
};
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
  "/game",
  "/business",
  "/marketplace",
  "/dashboard",
  "/community",
  "/community/social",
  "/community/social/studio",
  "/community/social/studio/ugc"
]) {
  await navigate(path);

  if (path === "/game") {
    await waitForHeading("h1", "Construa sua primeira cadeia de valor", "Mundo jogável");
    const state = await waitForWorldEconomy();
    report.economySurfaces = {
      ...(report.economySurfaces ?? {}),
      world: {
        ready: true,
        location: state.location,
        localBusinessCount: Number(state.localBusinessCount),
        text: state.economyText.slice(0, 240),
        businessText: state.businessText.slice(0, 240)
      }
    };
  }
  if (path === "/business") {
    await waitForHeading("h1", "Transforme um endereço", "Economia empresarial");
    const state = await waitForAuthenticatedSurface(
      "Economia empresarial autenticada de Nova Aurora",
      "Economia empresarial"
    );
    report.economySurfaces = { ...(report.economySurfaces ?? {}), business: { ready: true, text: state.text.slice(0, 240) } };
  }
  if (path === "/marketplace") {
    await waitForHeading("h1", "Empresas abertas", "Marketplace público");
    const state = await waitForAuthenticatedSurface(
      "Mercado autenticado de Nova Aurora",
      "Marketplace público"
    );
    const consoleState = await waitForMarketProductionConsole();
    report.economySurfaces = {
      ...(report.economySurfaces ?? {}),
      marketplace: { ready: true, text: state.text.slice(0, 240) },
      marketProduction: {
        ready: true,
        refreshMs: consoleState.refreshMs,
        itemOptions: consoleState.itemOptions,
        recipeOptions: consoleState.recipeOptions,
        text: consoleState.text.slice(0, 240)
      }
    };
  }
  if (path === "/dashboard") {
    await waitForHeading("h1", "Sua economia", "Dashboard econômico");
    const state = await waitForAuthenticatedSurface(
      "Painel econômico autenticado de Nova Aurora",
      "Dashboard econômico"
    );
    report.economySurfaces = { ...(report.economySurfaces ?? {}), dashboard: { ready: true, text: state.text.slice(0, 240) } };
  }
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

await new Promise((resolve) => setTimeout(resolve, 1_000));
const issues = report.pages.flatMap((page) => page.issues.map((issue) => `${page.path}: ${issue}`));
const finalReport = { ...report, exceptions: [...exceptions], issues };
await writeFile(reportFile, JSON.stringify(finalReport, null, 2));
if (issues.length > 0) throw new Error(`Falhas de acessibilidade: ${issues.join("; ")}`);
if (exceptions.length > 0) throw new Error(`Exceções no navegador: ${exceptions.join("; ")}`);
if (
  !report.economySurfaces?.world?.ready
  || !report.economySurfaces?.business?.ready
  || !report.economySurfaces?.marketplace?.ready
  || !report.economySurfaces?.marketProduction?.ready
  || !report.economySurfaces?.dashboard?.ready
) {
  throw new Error("Superfícies econômicas autenticadas não produziram evidência completa.");
}

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
  authenticatedWorldEconomyReady: report.economySurfaces?.world?.ready ?? false,
  worldLocalBusinessesCount: report.economySurfaces?.world?.localBusinessCount ?? null,
  authenticatedBusinessReady: report.economySurfaces?.business?.ready ?? false,
  authenticatedMarketplaceReady: report.economySurfaces?.marketplace?.ready ?? false,
  marketProductionConsoleReady: report.economySurfaces?.marketProduction?.ready ?? false,
  authenticatedDashboardReady: report.economySurfaces?.dashboard?.ready ?? false,
  signature: "Tehkné Solutions"
}));

// Tehkné Solutions
