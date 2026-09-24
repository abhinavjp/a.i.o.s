import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { browserAcceptanceConfig as config } from "../../playwright.config.mjs";
import { fixture, routeFixture, startFixtureServer } from "./fixture.mjs";

let server;
let browser;

before(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: config.headless });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openFixturePage({ width = config.viewports.desktop.width, height = 900, reducedMotion, overrides = {} } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...(reducedMotion ? { reducedMotion } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const requests = [];
  await context.route("**/api/**", (route) => routeFixture(route, requests, overrides));
  await page.goto(config.baseURL);
  await page.locator("main.mc-root").waitFor();
  await page.waitForFunction(() => {
    const root = document.querySelector("main.mc-root");
    return !!root && !root.classList.contains("mc-loading");
  });
  return { context, page, requests };
}

async function closeFixturePage(context) { await context.close(); }

async function assertDialogFocusLoop(page, dialog, trigger) {
  await dialog.waitFor();
  const focusable = dialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  const count = await focusable.count();
  assert.ok(count >= 2, "each modal variant must expose keyboard controls");
  const first = focusable.nth(0);
  const last = focusable.nth(count - 1);
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.locator(":focus").count(), 1, "Shift+Tab from the first control must wrap within the dialog");
  assert.equal(await dialog.locator(":focus").evaluate((element) => element === document.activeElement), true);
  await last.focus();
  await page.keyboard.press("Tab");
  assert.equal(await first.evaluate((element) => document.activeElement === element), true, "Tab from the last control must wrap to the first");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "closing restores focus to the opening control");
}

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map((part) => Number(part) / 255).map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

async function auditRenderedActions(page) {
  return page.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0;
    const controls = [...document.querySelectorAll("button, a[href]")].filter(visible).map((element) => ({
      name: (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").trim(),
      href: element instanceof HTMLAnchorElement ? element.href : null
    }));
    const unnamed = controls.filter((control) => !control.name);
    const external = controls.filter((control) => control.href && new URL(control.href).origin !== location.origin && !control.href.startsWith("file:"));
    const simulated = controls.filter((control) => /simulate|pretend|fake success|mark (?:fixed|merged)|resolve (?:thread|discussion)|create jira ticket/i.test(control.name));
    return { controls, unnamed, external, simulated };
  });
}

test("REQ-004: decision dialog contains keyboard focus and restores it after Escape", async () => {
  const { context, page } = await openFixturePage();
  const trigger = page.getByRole("button", { name: "Review route.change" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Decision details" });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close details");

  await page.keyboard.press("Shift+Tab");
  assert.ok(await dialog.locator(":focus").count(), "modal focus must not escape to the page behind it");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
  await closeFixturePage(context);
});

test("AC-01: populated Mission Control keeps reference tokens, hierarchy and access across all three bands", async () => {
  const screenshotDirectory = path.resolve(config.screenshotDirectory);
  await mkdir(screenshotDirectory, { recursive: true });
  assert.ok((await stat(path.join(screenshotDirectory, "tsk012-reference-desktop.png"))).size > 0);
  const referenceTokens = { background: "#0d0f13", card: "#16181d", amber: "#e0a44a", blue: "#7b8ff5" };

  for (const [name, viewport] of Object.entries(config.viewports)) {
    const { context, page } = await openFixturePage(viewport);
    await page.getByRole("main", { name: "Sarathi Mission Control" }).waitFor();
    await page.getByRole("heading", { name: "1 thing need you" }).waitFor();
    const main = page.getByRole("main", { name: "Sarathi Mission Control" });
    const asks = page.getByRole("region", { name: "Asks" });
    const pipeline = page.getByRole("region", { name: "Work pipeline" });
    const activity = page.getByRole("region", { name: "Activity" });
    const agents = page.getByRole("region", { name: "Agents" });
    for (const region of [asks, pipeline, activity, agents]) assert.ok(await region.count(), `${name} retains ${await region.getAttribute("aria-label")}`);
    const [asksBox, pipelineBox, activityBox] = await Promise.all([asks.boundingBox(), pipeline.boundingBox(), activity.boundingBox()]);
    assert.ok(asksBox.y < pipelineBox.y && pipelineBox.y < activityBox.y, `${name} keeps the asks → pipeline → activity hierarchy`);
    assert.ok(await pipeline.getByText("1 / 3 stages · 1 / 2 tasks").count(), `${name} reports counted fixture progress`);
    assert.equal(await main.evaluate((element) => getComputedStyle(element).getPropertyValue("--mc-bg").trim()), referenceTokens.background);
    assert.equal(await main.evaluate((element) => getComputedStyle(element).getPropertyValue("--mc-card").trim()), referenceTokens.card);
    assert.equal(await main.evaluate((element) => getComputedStyle(element).getPropertyValue("--mc-amber").trim()), referenceTokens.amber);
    assert.equal(await main.evaluate((element) => getComputedStyle(element).getPropertyValue("--mc-blue").trim()), referenceTokens.blue);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} has no horizontal overflow`);
    const renderedText = await page.locator("body").innerText();
    assert.match(renderedText, /Sarathi/);
    assert.doesNotMatch(renderedText, /a\.i\.o\.s|Agentic OS/i);
    await page.screenshot({ path: path.join(screenshotDirectory, `tsk012-${name}.png`), fullPage: true, animations: "disabled" });
    await closeFixturePage(context);
  }
});

test("REQ-004: ask, work, catch-up and connection dialogs wrap first/last Tab and restore focus", async () => {
  const { context, page } = await openFixturePage();

  let trigger = page.getByRole("button", { name: "Review route.change" });
  await trigger.click();
  await assertDialogFocusLoop(page, page.getByRole("dialog", { name: "Decision details" }), trigger);

  trigger = page.getByRole("button", { name: "Details for Fixture queue item" });
  await trigger.click();
  await assertDialogFocusLoop(page, page.getByRole("dialog", { name: "Work item details" }), trigger);

  trigger = page.getByRole("button", { name: "Catch up on 1" });
  await trigger.click();
  await assertDialogFocusLoop(page, page.getByRole("dialog", { name: "Catch up" }), trigger);

  trigger = page.getByRole("button", { name: "Connections" });
  await trigger.click();
  await assertDialogFocusLoop(page, page.getByRole("dialog", { name: "Connections and setup" }), trigger);
  await closeFixturePage(context);
});

test("AC-02: decisions and high-risk policy edits use canonical endpoints and surface floor rejection", async () => {
  const accepted = await openFixturePage();
  await accepted.page.getByRole("button", { name: "Review route.change" }).click();
  await accepted.page.getByRole("dialog", { name: "Decision details" }).getByRole("button", { name: "Approve" }).click();
  const approve = accepted.requests.find((request) => request.path === "/api/sarathi/asks/ask-browser-1/decide");
  assert.equal(approve?.method, "POST");
  assert.deepEqual(JSON.parse(approve?.body ?? "{}"), { decision: "approved" });
  await closeFixturePage(accepted.context);

  const floorAsk = { id: "ask-floor-1", kind: "protected.release", risk: "high", workItemId: null, createdAt: "2026-09-24T08:30:00.000Z", intent: { tool: "system-release", operation: "release.apply", target: "stable", context: { body: "Protected release decision" } } };
  const protectedPage = await openFixturePage({ overrides: {
    dashboard: { ...fixture.dashboard, asks: [floorAsk] },
    actionResponses: { "PUT /api/sarathi/autopilot": { status: 403, body: { error: "Blocked by immutable floor" } } }
  } });
  await protectedPage.page.getByRole("combobox", { name: "Autopilot high-risk decisions" }).selectOption("automatic");
  await protectedPage.page.getByRole("alert").filter({ hasText: "Blocked by immutable floor" }).waitFor();
  const autopilot = protectedPage.requests.find((request) => request.path === "/api/sarathi/autopilot");
  assert.equal(autopilot?.method, "PUT");
  assert.equal(JSON.parse(autopilot?.body ?? "{}").high, "automatic");
  assert.deepEqual((await auditRenderedActions(protectedPage.page)).external, []);
  await closeFixturePage(protectedPage.context);
});

test("AC-03: counted work and stale track decisions preserve current/proposed state after conflict", async () => {
  const staleAsk = { id: "ask-track-stale", kind: "track.change", risk: "medium", workItemId: "work-browser-1", createdAt: "2026-09-24T08:30:00.000Z", intent: { tool: "delivery-pipeline", operation: "track.change", target: "work-browser-1", context: { currentTrack: JSON.stringify(["plan", "implementation"]), proposedTrack: JSON.stringify(["plan", "implementation", "final-review"]) } } };
  const { context, page, requests } = await openFixturePage({ overrides: {
    dashboard: { ...fixture.dashboard, asks: [staleAsk] },
    actionResponses: { "POST /api/sarathi/asks/ask-track-stale/decide": { status: 409, body: { error: "The track changed after this ask was created." } } }
  } });
  const pipeline = page.getByRole("region", { name: "Work pipeline" });
  assert.ok(await pipeline.getByText("1 / 3 stages · 1 / 2 tasks").count());
  await page.getByRole("button", { name: "Review track.change" }).click();
  const dialog = page.getByRole("dialog", { name: "Decision details" });
  assert.ok(await dialog.getByText("Current track: plan → implementation").count());
  assert.ok(await dialog.getByText("Proposed track: plan → implementation → final-review").count());
  await dialog.getByRole("button", { name: "Approve" }).click();
  await dialog.getByRole("alert").filter({ hasText: "track changed" }).waitFor();
  assert.ok(requests.some((request) => request.path === "/api/sarathi/asks/ask-track-stale/decide" && request.method === "POST"));
  assert.equal(requests.some((request) => /\/track(?:\/|$)/.test(request.path) && request.method !== "GET"), false);
  await closeFixturePage(context);
});

test("AC-04/05: Jira and GitLab actions show observed outcomes without external writes or invented remediation", async () => {
  const timestamp = "2026-09-24T08:30:00.000Z";
  const observation = { id: "discussion-browser-1", workItemId: "work-browser-1", repository: "fixture/service", mergeRequestIid: 9, mergeRequestTitle: "Fixture review", discussionId: "discussion-9", resolved: false, notes: [{ id: 1, body: "Please clarify this change", author: { id: 2, username: "reviewer", name: "Fixture reviewer" }, authorship: "human", system: false, resolvable: true, resolved: false, createdAt: timestamp, updatedAt: timestamp }], askId: "ask-discussion-1", firstObservedAt: timestamp, lastObservedAt: timestamp, status: "observed", admissionState: "blocked", blockedReason: "No eligible agent capability was observed.", taskId: null, milestones: { admitted: null, fixProduced: null, pushed: null, pipeline: null, resolved: null } };
  const discussionAsk = { id: "ask-discussion-1", kind: "gitlab.discussion.remediate", risk: "medium", workItemId: "work-browser-1", createdAt: timestamp, intent: { tool: "gitlab", operation: "discussion.remediate", target: "discussion-browser-1", context: { body: "Please clarify this change" } } };
  const { context, page, requests } = await openFixturePage({ overrides: {
    dashboard: { ...fixture.dashboard, asks: [discussionAsk] },
    board: { ...fixture.board, gitLabDiscussions: { ...fixture.board.gitLabDiscussions, sync: { ...fixture.board.gitLabDiscussions.sync, configured: true, state: "available" }, observations: [observation] } }
  } });
  const discussions = page.getByRole("region", { name: "GitLab discussions and remediation" });
  assert.ok(await discussions.getByText("No eligible agent capability was observed.").count());
  assert.ok(await discussions.getByText("Thread resolution not observed").count());
  assert.equal(await discussions.getByText("Thread resolved by GitLab").count(), 0);

  await page.getByRole("button", { name: "Connections" }).click();
  const connections = page.getByRole("dialog", { name: "Connections and setup" });
  await connections.getByRole("button", { name: "Check Jira for work items" }).click();
  await connections.getByRole("status").filter({ hasText: "Jira check complete: 1 new work items" }).waitFor();
  await connections.getByRole("button", { name: "Check GitLab discussions" }).click();
  await connections.getByRole("status").filter({ hasText: "GitLab discussion check complete" }).waitFor();
  assert.ok(requests.some((request) => request.path === "/api/work-items/import" && request.method === "POST"));
  assert.ok(requests.some((request) => request.path === "/api/code-host/discussions/sync" && request.method === "POST"));
  assert.equal(requests.some((request) => /(?:jira|gitlab)\.(?:com|net)|\/api\/(?:gitlab|jira)\/(?:write|comment|merge|resolve)/i.test(request.path)), false);
  await closeFixturePage(context);
});

test("AC-06: first-run readiness stays incomplete, secrets clear, and setup failures remain recoverable", async () => {
  const secret = "fixture-only-secret-value";
  const setup = await openFixturePage({ overrides: { setup: { firstRun: true, steps: { workSource: false, codeHost: false, agent: false } } } });
  await setup.page.getByRole("main", { name: "Sarathi setup" }).waitFor();
  await setup.page.getByRole("heading", { name: "Connect Sarathi" }).waitFor();
  assert.ok(await setup.page.getByRole("heading", { name: "1. Jira work items" }).count());
  assert.ok(await setup.page.getByRole("heading", { name: "2. GitLab code reviews" }).count());
  assert.ok(await setup.page.getByRole("heading", { name: "3. Agents" }).count());
  assert.equal(await setup.page.getByRole("button", { name: "Continue to command center" }).count(), 0);
  await setup.page.getByLabel("Jira API token").fill(secret);
  await setup.page.getByRole("button", { name: "Save Jira token" }).click();
  await setup.page.getByText("Jira token saved locally and cleared from this form. Check the connection to confirm it works.").waitFor();
  assert.equal(await setup.page.getByLabel("Jira API token").inputValue(), "");
  assert.doesNotMatch(await setup.page.locator("body").innerText(), new RegExp(secret));
  assert.equal(await setup.page.evaluate(() => localStorage.length), 0);
  assert.ok(setup.requests.some((request) => request.path === "/api/credentials/keychain" && JSON.parse(request.body).reference === "JIRA_TOKEN" && JSON.parse(request.body).value === secret));
  await closeFixturePage(setup.context);

  const recovering = await openFixturePage({ overrides: { setupResponses: {
    1: { status: 503, body: { error: "setup store unavailable" } },
    2: { status: 503, body: { error: "setup store unavailable" } },
    3: { body: fixture.setup }
  } } });
  await recovering.page.getByRole("heading", { name: "Setup status is unavailable" }).waitFor();
  assert.ok(await recovering.page.getByRole("alert").filter({ hasText: "Could not read setup status" }).count());
  await recovering.page.getByRole("button", { name: "Retry setup read" }).click();
  await recovering.page.getByRole("main", { name: "Sarathi Mission Control" }).waitFor();
  await recovering.page.getByRole("heading", { name: "1 thing need you" }).waitFor();
  await closeFixturePage(recovering.context);
});

test("AC-07 and REQ-025: advanced controls stay reachable and rendered actions are named and non-simulated", async () => {
  const { context, page } = await openFixturePage();
  const audit = await auditRenderedActions(page);
  assert.deepEqual(audit.unnamed, []);
  assert.deepEqual(audit.external, []);
  assert.deepEqual(audit.simulated, []);
  await page.getByRole("button", { name: "Advanced controls" }).click();
  const main = page.getByRole("main", { name: "Sarathi advanced controls" });
  await main.getByRole("heading", { name: "Advanced controls" }).waitFor();
  const nav = page.getByRole("navigation", { name: "Advanced settings sections" });
  for (const label of ["Work items", "Agents and tasks", "Runtime and providers", "Routing and consent"]) assert.ok(await nav.getByRole("link", { name: label }).count());
  assert.ok(await page.getByRole("region", { name: "Direct task execution" }).count());
  assert.ok(await page.getByRole("region", { name: "Runtime and providers" }).count());
  assert.ok(await page.getByRole("region", { name: "Routing and consent" }).count());
  assert.ok(await page.getByRole("button", { name: "Back to Mission Control" }).count());
  const advancedAudit = await auditRenderedActions(page);
  assert.deepEqual(advancedAudit.unnamed, []);
  assert.deepEqual(advancedAudit.external, []);
  assert.deepEqual(advancedAudit.simulated, []);
  assert.ok(await page.getByRole("button", { name: /Check now/ }).count());
  await closeFixturePage(context);
});

test("REQ-025: rendered shell actions use canonical requests or read-only details", async () => {
  const { context, page, requests } = await openFixturePage();
  await page.getByRole("button", { name: "Catch up on 1" }).click();
  const catchUp = page.getByRole("dialog", { name: "Catch up" });
  await catchUp.getByRole("button", { name: "Skip (S)" }).click();
  await catchUp.getByRole("button", { name: "Leave catch-up" }).click();
  await page.getByRole("button", { name: "Details for Fixture queue item" }).click();
  await page.getByRole("dialog", { name: "Work item details" }).getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Fixture queue item Plan stage: done" }).click();
  await page.getByRole("dialog", { name: "Stage details" }).getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Details for Local fixture agent" }).click();
  await page.getByRole("dialog", { name: "Agent details" }).getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("dialog", { name: "Connections and setup" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  const writes = requests.filter((request) => request.method !== "GET");
  assert.deepEqual(writes.map(({ method, path }) => `${method} ${path}`), ["POST /api/sarathi/control/pause"]);
  assert.deepEqual(JSON.parse(writes[0].body), { paused: true });
  assert.deepEqual((await auditRenderedActions(page)).simulated, []);
  await closeFixturePage(context);
});

test("REQ-004: names, roles, keyboard focus, reduced motion and text contrast are accessible", async () => {
  const { context, page } = await openFixturePage({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => ({
    name: document.activeElement?.textContent?.trim(),
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
    outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    transitionDuration: getComputedStyle(document.querySelector(".mc-primary")).transitionDuration,
    regionNames: [...document.querySelectorAll('[role="region"], [role="dialog"]')].map((element) => element.getAttribute("aria-label") || element.getAttribute("aria-labelledby"))
  }));
  assert.match(focus.name, /Skip to asks/);
  assert.ok(Number.parseFloat(focus.outlineWidth) >= 2);
  assert.equal(focus.outlineStyle, "solid");
  assert.equal(focus.reduced, true);
  assert.ok(Number.parseFloat(focus.transitionDuration) <= 0.01);
  assert.ok(focus.regionNames.every(Boolean));

  const colors = await page.locator(".mc-root").evaluate((root) => {
    const style = getComputedStyle(root);
    return ["--mc-ink", "--mc-muted", "--mc-faint", "--mc-amber", "--mc-blue"].map((name) => style.getPropertyValue(name).trim()).map((color) => {
      const temporary = document.createElement("span");
      temporary.style.color = color;
      root.appendChild(temporary);
      const computed = getComputedStyle(temporary).color;
      temporary.remove();
      return { foreground: computed, background: style.getPropertyValue("--mc-bg2").trim() };
    });
  });
  const rgba = (color) => {
    const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
    if (hex) return `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    return color;
  };
  for (const color of colors) assert.ok(contrastRatio(color.foreground, rgba(color.background)) >= 4.5, `${color.foreground} must have 4.5:1 contrast on ${color.background}`);
  await closeFixturePage(context);
});
