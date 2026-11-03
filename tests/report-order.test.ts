import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sortReportItems } from "../client/src/lib/report-order";

const dates = (items: { date: string }[]) => items.map(item => item.date);

test("prepaid first, then oldest dates across months and years", () => {
  const items = ["2026-11-02", "2026-01-10", "prepaid", "2025-12-31", "2026-01-02"]
    .map(date => ({ date }));
  assert.deepEqual(dates(sortReportItems(items)), [
    "prepaid", "2025-12-31", "2026-01-02", "2026-01-10", "2026-11-02",
  ]);
});

test("chronological ordering does not depend on entry order", () => {
  function permutations<T>(items: T[]): T[][] {
    if (!items.length) return [[]];
    return items.flatMap((item, index) =>
      permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
  }
  const expected = ["prepaid", "2025-12-31", "2026-01-01", "2026-02-01"];
  for (const input of permutations(expected)) {
    assert.deepEqual(dates(sortReportItems(input.map(date => ({ date })))), expected);
  }
});

test("equal dates and prepaid items retain their relative entry order", () => {
  const items = [
    { id: 1, date: "2026-01-01" }, { id: 2, date: "prepaid" },
    { id: 3, date: "2026-01-01" }, { id: 4, date: "prepaid" },
  ];
  assert.deepEqual(sortReportItems(items).map(i => i.id), [2, 4, 1, 3]);
});

test("sorting leaves the original array, item data, and totals untouched", () => {
  const items = Object.freeze([
    Object.freeze({ date: "2026-02-01", amountUsd: 30, sortOrder: 0 }),
    Object.freeze({ date: "prepaid", amountUsd: 20, sortOrder: 1 }),
    Object.freeze({ date: "2026-01-01", amountUsd: 10, sortOrder: 2 }),
  ]);
  const sorted = sortReportItems(items);
  assert.notEqual(sorted, items);
  assert.equal(sorted[0], items[1]);
  assert.deepEqual(items.map(i => i.sortOrder), [0, 1, 2]);
  assert.equal(sorted.reduce((sum, i) => sum + i.amountUsd, 0), 60);
});

test("blank or invalid dates follow dated items without dropping any entries", () => {
  const items = ["", "2026-02-30", "2024-02-29", "not-a-date", "prepaid", "2026-01-01"]
    .map(date => ({ date }));
  assert.deepEqual(dates(sortReportItems(items)), [
    "prepaid", "2024-02-29", "2026-01-01", "", "2026-02-30", "not-a-date",
  ]);
});

test("empty, single-item, all-prepaid, and already-sorted reports", () => {
  for (const input of [[], ["prepaid"], ["prepaid", "prepaid"], ["2026-01-01"],
    ["prepaid", "2025-12-31", "2026-01-01"]]) {
    assert.deepEqual(dates(sortReportItems(input.map(date => ({ date })))), input);
  }
});

test("actual report renders sorted monthly and travel tables with unchanged totals", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = await mkdtemp(path.join(root, "tests", ".report-order-"));
  try {
    // Exercise the real print/PDF component; replace only routing and data access.
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["client/src/pages/PrintReportPage.tsx"],
      bundle: true, write: false, format: "esm", platform: "node",
      packages: "external", jsx: "automatic",
      plugins: [{
        name: "report-test-data",
        setup(builder) {
          builder.onResolve({ filter: /^(@tanstack\/react-query|wouter|@\/lib\/queryClient)$/ },
            args => ({ path: args.path, namespace: "test-data" }));
          builder.onLoad({ filter: /.*/, namespace: "test-data" }, args => ({
            contents: args.path === "wouter"
              ? "export const useParams = () => ({id:'1'}); export const useLocation = () => ['/', () => {}];"
              : args.path === "@/lib/queryClient"
                ? "export const apiRequest = () => { throw new Error('Unexpected network access'); };"
                : `export const useQuery = ({queryKey}) => ({
                    data: queryKey[0] === '/api/settings' ? {} : globalThis.__reportOrderFixture,
                    isLoading: false
                  });`,
          }));
        },
      }],
    });
    const modulePath = path.join(temp, "report.mjs");
    await writeFile(modulePath, result.outputFiles[0].text);
    const { default: PrintReportPage } = await import(pathToFileURL(modulePath).href);
    const makeItem = (id: number, date: string, billedToCard: boolean) => ({
      id, reportId: 1, date, billedToCard, purpose: `Expense-${id}`,
      category: "Supplies", currency: "USD", amount: 10, amountUsd: 10,
      exchangeRate: 1, isMileage: false, miles: 0, notes: "", sortOrder: id,
    });
    const items = [
      makeItem(1, "2026-11-02", false), makeItem(2, "2026-11-02", true),
      makeItem(3, "prepaid", false), makeItem(4, "prepaid", true),
      makeItem(5, "2025-12-31", false), makeItem(6, "2025-12-31", true),
    ];
    const globals = globalThis as typeof globalThis & { __reportOrderFixture?: unknown };
    for (const type of ["monthly", "travel"]) {
      globals.__reportOrderFixture = {
        report: { id: 1, name: "Ordering test", type, submitterName: "Test",
          tripPurpose: "Test", dateSubmitted: "2026-11-02", status: "draft" },
        items: type === "travel" ? items : items.filter(i => !i.billedToCard),
      };
      const html = renderToStaticMarkup(createElement(PrintReportPage));
      const tables = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(match => match[1]);
      const ids = (table: string) => [...table.matchAll(/Expense-(\d+)/g)].map(match => Number(match[1]));
      assert.equal(tables.length, type === "travel" ? 2 : 1);
      assert.deepEqual(ids(tables[0]), [3, 5, 1]);
      assert.match(tables[0], /\$30\.00/);
      if (type === "travel") {
        assert.deepEqual(ids(tables[1]), [4, 6, 2]);
        assert.match(tables[1], /\$30\.00/);
        assert.match(html, /\$60\.00/);
      }
      assert.match(html, /TOTAL REIMBURSEMENT DUE<\/span><span>\$30\.00/);
      assert.deepEqual(items.map(i => i.id), [1, 2, 3, 4, 5, 6]);
    }
  } finally {
    delete (globalThis as typeof globalThis & { __reportOrderFixture?: unknown }).__reportOrderFixture;
    await rm(temp, { recursive: true, force: true });
  }
});
