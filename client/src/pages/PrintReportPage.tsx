import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { ExpenseReport, ExpenseItem } from "@shared/schema";
import { SETTINGS_KEYS } from "@shared/schema";
import { ArrowLeft, Printer } from "lucide-react";

const MILEAGE_RATE = 0.725;
const MEAL_RATE = 0.5;

export default function PrintReportPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{ report: ExpenseReport; items: ExpenseItem[] }>({
    queryKey: ["/api/reports", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/${id}`);
      return res.json();
    },
  });

  const { data: settings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings");
      return res.json();
    },
  });

  if (isLoading || !data) {
    return <div className="p-8 text-center text-muted-foreground">Loading report…</div>;
  }

  const { report, items } = data;
  const isTravel = report.type === "travel";

  const reimbursableItems = items.filter(i => !i.billedToCard);
  const cardItems = items.filter(i => i.billedToCard);
  // Sum in integer cents to avoid IEEE-754 floating-point drift that caused
  // the total to appear 1 cent higher than the sum of the displayed line items.
  const totalReimbursable = reimbursableItems.reduce((s, i) => s + Math.round(i.amountUsd * 100), 0) / 100;
  const totalCard = cardItems.reduce((s, i) => s + Math.round(i.amountUsd * 100), 0) / 100;
  const totalAll = items.reduce((s, i) => s + Math.round(i.amountUsd * 100), 0) / 100;
  const taxDeductible = reimbursableItems.reduce((s, i) => {
    const cents = Math.round(i.amountUsd * 100);
    return s + (i.category?.toLowerCase() === "meals" ? Math.round(cents * MEAL_RATE) : cents);
  }, 0) / 100;

  const formatDate = (d: string) => {
    if (!d) return "—";
    if (d === "prepaid") return "Prepaid";
    const dt = new Date(d + "T12:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatAmt = (n: number) => n.toFixed(2);

  return (
    <>
      {/* Print toolbar — hidden in print */}
      <div className="print:hidden flex items-center gap-3 p-4 border-b border-border bg-card">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/report/${id}`)}>
          <ArrowLeft className="w-4 h-4" /> Back to Editor
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print / Save PDF
        </Button>
      </div>

      {/* Print content */}
      <div className="print-page max-w-4xl mx-auto px-8 py-8 print:px-6 print:py-6 bg-white text-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-800">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isTravel
                ? (settings[SETTINGS_KEYS.TRAVEL_HEADER] || "Travel Expense Report")
                : (settings[SETTINGS_KEYS.MONTHLY_HEADER] || "Monthly Expense Report")
              }
            </h1>
            <p className="text-gray-600 mt-0.5">{report.name}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-gray-800">{report.submitterName || "—"}</p>
            <p className="text-gray-600">Submitted: {formatDate(report.dateSubmitted)}</p>
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Requestor</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{report.submitterName || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Purpose</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{report.tripPurpose || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date Submitted</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{formatDate(report.dateSubmitted)}</p>
          </div>
        </div>

        {/* Reimbursable items */}
        {reimbursableItems.length > 0 && (
          <div className="mb-6">
            {isTravel && cardItems.length > 0 && (
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                Reimbursable Expenses
              </h2>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600 w-24">Date</th>
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Description</th>
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600 w-36">Category</th>
                  <th className="text-right py-2 text-xs font-semibold text-gray-600 w-28">Amount (USD)</th>
                </tr>
              </thead>
              <tbody>
                {reimbursableItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700 text-xs align-top">{formatDate(item.date)}</td>
                    <td className="py-2 pr-3 text-gray-900 align-top">
                      <span>{item.purpose || "—"}</span>
                      {item.isMileage && item.miles > 0 && (
                        <span className="text-gray-500 text-xs ml-1">({item.miles} miles × $0.725)</span>
                      )}
                      {item.currency !== "USD" && !item.isMileage && (
                        <span className="text-gray-500 text-xs ml-1">
                          ({item.currency} {formatAmt(item.amount)} @ {item.exchangeRate.toFixed(4)})
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 text-xs align-top">{item.category}</td>
                    <td className="py-2 text-right font-medium align-top">
                      ${formatAmt(item.amountUsd)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-400 font-bold">
                  <td colSpan={3} className="py-2 pr-3 text-sm">Subtotal — Reimbursable</td>
                  <td className="py-2 text-right text-sm">${formatAmt(totalReimbursable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Corporate card items (travel only) */}
        {isTravel && cardItems.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
              Billed to Corporate Credit Card
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600 w-24">Date</th>
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Description</th>
                  <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600 w-36">Category</th>
                  <th className="text-right py-2 text-xs font-semibold text-gray-600 w-28">Amount (USD)</th>
                </tr>
              </thead>
              <tbody>
                {cardItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700 text-xs align-top">{formatDate(item.date)}</td>
                    <td className="py-2 pr-3 text-gray-900 align-top">
                      <span>{item.purpose || "—"}</span>
                      {item.currency !== "USD" && (
                        <span className="text-gray-500 text-xs ml-1">
                          ({item.currency} {formatAmt(item.amount)} @ {item.exchangeRate.toFixed(4)})
                        </span>
                      )}
                      <span className="ml-2 text-xs text-blue-700 font-medium">[Corporate Card]</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-700 text-xs align-top">{item.category}</td>
                    <td className="py-2 text-right font-medium align-top">${formatAmt(item.amountUsd)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-400 font-bold">
                  <td colSpan={3} className="py-2 pr-3 text-sm">Subtotal — Corporate Card</td>
                  <td className="py-2 text-right text-sm">${formatAmt(totalCard)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Summary box */}
        <div className="mt-6 border border-gray-300 rounded p-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Summary</h2>
          <div className="space-y-1.5">
            {/* Reimbursable line — always shown */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Reimbursable expenses</span>
              <span className="font-medium">${formatAmt(totalReimbursable)}</span>
            </div>
            {/* Corporate card line — travel only */}
            {isTravel && cardItems.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Billed to corporate card</span>
                <span className="font-medium">${formatAmt(totalCard)}</span>
              </div>
            )}
            {/* Total expenses — always shown */}
            <div className="flex justify-between text-sm border-t border-gray-200 pt-1.5">
              <span className="font-semibold text-gray-700">Total expenses</span>
              <span className="font-semibold">${formatAmt(totalAll)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Tax deductible amount <span className="text-xs">(meals at 50%)</span></span>
              <span className="font-medium">${formatAmt(taxDeductible)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t-2 border-gray-700 pt-2 mt-2">
              <span>TOTAL REIMBURSEMENT DUE</span>
              <span>${formatAmt(totalReimbursable)}</span>
            </div>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8 print:mt-16">
          <div>
            <div className="border-b border-gray-400 pb-1 mb-1 h-10"></div>
            <p className="text-xs text-gray-600">Requestor Signature &amp; Date</p>
          </div>
          <div>
            <div className="border-b border-gray-400 pb-1 mb-1 h-10"></div>
            <p className="text-xs text-gray-600">Approver Signature &amp; Date</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
          <span>Mileage reimbursed at 2026 IRS standard rate: $0.725/mile</span>
          <span>Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
        </div>
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: white; }
          .print-page { max-width: 100%; margin: 0; padding: 1.5cm; }
        }
      `}</style>
    </>
  );
}
