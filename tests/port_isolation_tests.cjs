#!/usr/bin/env node
/**
 * Port-isolation regression tests.
 *
 * Bug: with TimeTrack running, launching Expense Track showed TimeTrack.
 * Both apps hard-coded port 5000; Expense Track's listen() lost the race,
 * its readiness poll was answered by TimeTrack's server, and the window
 * rendered TimeTrack's UI.
 *
 * These tests assert the two independent guarantees that close that hole:
 *   1. Expense Track never binds a port another process already holds.
 *   2. Expense Track refuses to attach to a server that is not its own.
 *
 * Run:  node tests/port_isolation_tests.cjs
 * Requires `npm run build` to have produced dist/index.cjs.
 */

const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const assert = require("assert");

const {
  PREFERRED_PORTS,
  isPortFree,
  allocateFreePort,
  waitForOwnServer,
  fetchHealth,
} = require("../electron/port-utils.cjs");

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/** Minimal stand-in for a rival Electron app's local server. */
function startImpostor(port, identity) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/api/health")) {
        res.end(JSON.stringify({ app: identity, ok: true }));
      } else {
        // The old readiness probe hit /api/reports and accepted any <500.
        res.end(JSON.stringify([]));
      }
    });
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function occupy(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

const close = (srv) => new Promise((r) => srv.close(r));

async function main() {
  console.log("\n=== Expense Track — port isolation regression tests ===\n");

  // ── 1. Allocation avoids ports held by other processes ────────────────────
  console.log("[allocation]");

  await test("allocateFreePort returns a usable, bindable port", async () => {
    const port = await allocateFreePort();
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `bad port ${port}`);
    assert.strictEqual(await isPortFree(port), true, "allocated port is not free");
  });

  await test("never returns 5000, the port TimeTrack hard-codes", async () => {
    const impostor = await startImpostor(5000, "timetrack");
    try {
      for (let i = 0; i < 5; i++) {
        assert.notStrictEqual(await allocateFreePort(), 5000);
      }
    } finally {
      await close(impostor);
    }
  });

  await test("skips occupied preferred ports and falls through to a free one", async () => {
    const held = [];
    try {
      // Occupy every preferred port except the last.
      for (const p of PREFERRED_PORTS.slice(0, -1)) held.push(await occupy(p));
      const port = await allocateFreePort();
      assert.strictEqual(port, PREFERRED_PORTS[PREFERRED_PORTS.length - 1]);
    } finally {
      for (const s of held) await close(s);
    }
  });

  await test("falls back to an ephemeral port when all preferred ports are taken", async () => {
    const held = [];
    try {
      for (const p of PREFERRED_PORTS) held.push(await occupy(p));
      const port = await allocateFreePort();
      assert.ok(!PREFERRED_PORTS.includes(port), `expected ephemeral, got ${port}`);
      assert.ok(port > 1024, `expected unprivileged port, got ${port}`);
    } finally {
      for (const s of held) await close(s);
    }
  });

  await test("two concurrent allocations do not both bind the same port", async () => {
    const a = await allocateFreePort();
    const holder = await occupy(a);
    try {
      const b = await allocateFreePort();
      assert.notStrictEqual(b, a, "second allocation collided with a held port");
    } finally {
      await close(holder);
    }
  });

  // ── 2. Identity check refuses foreign servers ─────────────────────────────
  console.log("\n[identity]");

  await test("rejects a server identifying as TimeTrack (the original bug)", async () => {
    const port = await allocateFreePort();
    const impostor = await startImpostor(port, "timetrack");
    try {
      await waitForOwnServer(port, 3000, 100);
      throw new Error("attached to TimeTrack's server — bug is NOT fixed");
    } catch (err) {
      assert.match(err.message, /different application/i, `unexpected error: ${err.message}`);
      assert.match(err.message, /timetrack/i, "error should name the foreign app");
    } finally {
      await close(impostor);
    }
  });

  await test("rejects an unidentified server that answers /api/reports with 200", async () => {
    const port = await allocateFreePort();
    const srv = http.createServer((_req, res) => res.end("[]"));
    await new Promise((r) => srv.listen(port, "127.0.0.1", r));
    try {
      await waitForOwnServer(port, 3000, 100);
      throw new Error("attached to an unidentified server");
    } catch (err) {
      assert.ok(
        /different application|malformed|did not respond/i.test(err.message),
        `unexpected error: ${err.message}`,
      );
    } finally {
      await close(srv);
    }
  });

  await test("times out cleanly when nothing is listening", async () => {
    const port = await allocateFreePort();
    try {
      await waitForOwnServer(port, 1000, 100);
      throw new Error("resolved against a dead port");
    } catch (err) {
      assert.match(err.message, /did not respond/i, `unexpected error: ${err.message}`);
    }
  });

  await test("health check tolerates a hostile oversized response", async () => {
    const port = await allocateFreePort();
    const srv = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.write("[");
      const chunk = "0".repeat(4096);
      for (let i = 0; i < 64; i++) res.write(chunk);
      res.end();
    });
    await new Promise((r) => srv.listen(port, "127.0.0.1", r));
    try {
      await fetchHealth(port);
      throw new Error("accepted an unbounded response body");
    } catch (err) {
      assert.ok(
        /too large|malformed|socket hang up|aborted/i.test(err.message),
        `unexpected error: ${err.message}`,
      );
    } finally {
      await close(srv);
    }
  });

  // ── 3. End-to-end against the real server bundle ──────────────────────────
  console.log("\n[end-to-end]");

  const bundle = path.join(__dirname, "..", "dist", "index.cjs");
  if (!fs.existsSync(bundle)) {
    console.log("  SKIP  dist/index.cjs not built — run `npm run build` first");
  } else {
    let impostor = null;
    let child = null;
    try {
      // Reproduce the exact field condition: TimeTrack already owns 5000.
      impostor = await startImpostor(5000, "timetrack");
      const port = await allocateFreePort();
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-test-"));

      child = spawn(process.execPath, [bundle], {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          NODE_ENV: "production",
          DATA_DIR: dataDir,
          STATIC_DIR: path.join(__dirname, "..", "dist", "public"),
          // Mirror how Electron points the bundle at the native SQLite binding.
          BETTER_SQLITE3_BINDING: path.join(
            __dirname, "..", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node",
          ),
        },
        stdio: "ignore",
      });

      await test("real server starts on the allocated port while 5000 is taken", async () => {
        const health = await waitForOwnServer(port, 20000, 200);
        assert.strictEqual(health.app, "expense-track");
        assert.strictEqual(health.appId, "com.expensetrack.app");
      });

      await test("port 5000 still answers as TimeTrack, untouched", async () => {
        const health = await fetchHealth(5000);
        assert.strictEqual(health.app, "timetrack");
      });

      await test("server is bound to loopback only, not 0.0.0.0", async () => {
        const external = Object.values(os.networkInterfaces())
          .flat()
          .filter((i) => i && i.family === "IPv4" && !i.internal)
          .map((i) => i.address);
        if (external.length === 0) {
          console.log("        (no external interface available to probe)");
          return;
        }
        const reachable = await new Promise((resolve) => {
          const sock = net.createConnection({ host: external[0], port, timeout: 1500 });
          sock.on("connect", () => { sock.destroy(); resolve(true); });
          sock.on("error", () => resolve(false));
          sock.on("timeout", () => { sock.destroy(); resolve(false); });
        });
        assert.strictEqual(reachable, false, `server reachable on ${external[0]}:${port}`);
      });
    } finally {
      if (child) child.kill("SIGKILL");
      if (impostor) await close(impostor);
    }
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
