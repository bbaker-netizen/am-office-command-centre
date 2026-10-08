/* A&M - QuickBooks reports, read into plain numbers.

   QuickBooks hands reports back as nested sections: a heading, the rows under
   it, and a "Total for" line. Adding every line counts things two or three
   times. That is how a receivables total of 2.7 million was reported on
   2026-10-06 when the real figure was 2.0 million. These readers take each
   customer or supplier once, and read named totals by their group, falling back
   to the label, so a renamed account shows as "not found" rather than a wrong
   number. */

const num = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
const colsOf = rep => ((rep && rep.Columns && rep.Columns.Column) || []).map(c => String(c.ColTitle || c.ColType || "").replace(/\s+/g, "").toLowerCase());
const rowsOf = node => (node && node.Rows && node.Rows.Row) || [];

/* ------------------------------------------------------------ aging (AR / AP)
   Each top-level line is one customer (or supplier). A customer with jobs under
   it comes as a section; its own summary line is that customer's total, jobs
   included. The grand total is skipped and the sum is ours. */
const BUCKET = { "current": "Current", "1-30": "1-30", "31-60": "31-60", "61-90": "61-90", "91andover": "91+", "91+": "91+", "total": "Total" };
export function readAging(rep) {
  const cols = colsOf(rep);
  const tot = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0, Total: 0 };
  const list = [];
  for (const r of rowsOf(rep)) {
    if (r.group === "GrandTotal") continue;
    let cells = null, name = "";
    if (r.type === "Section" || r.Summary) {
      cells = (r.Summary && r.Summary.ColData) || null;
      name = (r.Header && r.Header.ColData && r.Header.ColData[0] && r.Header.ColData[0].value) || "";
    } else {
      cells = r.ColData || null;
      name = (cells && cells[0] && cells[0].value) || "";
    }
    if (!cells) continue;
    if (/^total\b/i.test(name) && !r.Header) continue;
    const row = { name: String(name).replace(/^Total (for )?/i, ""), b: {}, total: 0 };
    cells.forEach((c, i) => { const k = BUCKET[cols[i]]; if (k === "Total") row.total = num(c.value); else if (k) row.b[k] = num(c.value); });
    for (const k of ["Current", "1-30", "31-60", "61-90", "91+"]) { row.b[k] = row.b[k] || 0; tot[k] += row.b[k]; }
    if (!row.total) row.total = Object.values(row.b).reduce((s, v) => s + v, 0);
    row.late = row.b["1-30"] + row.b["31-60"] + row.b["61-90"] + row.b["91+"];
    tot.Total += row.total;
    list.push(row);
  }
  tot.Late = tot["1-30"] + tot["31-60"] + tot["61-90"] + tot["91+"];
  const r2 = x => Math.round(x * 100) / 100;
  for (const k of Object.keys(tot)) tot[k] = r2(tot[k]);
  return { list, tot };
}

/* ---------------------------------------------- balance sheet, profit and loss
   Walks every line and keeps two indexes: section totals by QuickBooks group
   name, and every amount by its label. */
export function indexReport(rep) {
  const groups = {}, labels = {};
  const walk = rows => {
    for (const r of rows) {
      if (r.ColData) {
        const lab = String((r.ColData[0] && r.ColData[0].value) || "").trim();
        if (lab) labels[lab] = num(r.ColData[r.ColData.length - 1].value);
      }
      if (r.Header && r.Header.ColData) {
        const lab = String((r.Header.ColData[0] && r.Header.ColData[0].value) || "").trim();
        const v = r.Header.ColData[r.Header.ColData.length - 1].value;
        if (lab && v !== "" && v != null) labels[lab] = num(v);
      }
      if (r.Rows) walk(rowsOf(r));
      if (r.Summary && r.Summary.ColData) {
        const lab = String((r.Summary.ColData[0] && r.Summary.ColData[0].value) || "").trim();
        const v = num(r.Summary.ColData[r.Summary.ColData.length - 1].value);
        if (lab) labels[lab] = v;
        if (r.group) groups[r.group] = v;
      }
    }
  };
  walk(rowsOf(rep));
  const find = (group, ...res) => {
    if (group && groups[group] != null) return groups[group];
    for (const re of res) for (const k of Object.keys(labels)) if (re.test(k)) return labels[k];
    return null;
  };
  const sumWhere = re => { let s = 0, seen = false; for (const k of Object.keys(labels)) if (re.test(k) && !/^total\b/i.test(k)) { s += labels[k]; seen = true; } return seen ? s : null; };
  return { groups, labels, find, sumWhere };
}

export function readBalanceSheet(rep) {
  const ix = indexReport(rep);
  const cash = ix.find("BankAccounts", /^Total Bank Accounts$/i, /^Total Cash and Cash Equivalents$/i);
  const ar = ix.find("AR", /^Total Accounts Receivable/i);
  const ap = ix.find("AP", /^Total Accounts Payable/i);
  const ca = ix.find("CurrentAssets", /^Total Current Assets$/i);
  const cl = ix.find("CurrentLiabilities", /^Total Current Liabilities$/i);
  return {
    cash, arBS: ar, apBS: ap,
    currentAssets: ca, currentLiabilities: cl,
    wc: (ca != null && cl != null) ? Math.round((ca - cl) * 100) / 100 : null,
    ratio: (ca != null && cl) ? Math.round(ca / cl * 100) / 100 : null,
    holdbacks: ix.find(null, /^Holdbacks Receivable/i),
    inventory: ix.find(null, /^Inventory Asset$/i),
    tools: ix.find(null, /^Total Tools and Equipment$/i, /^Tools and Equipment$/i),
    vehicles: ix.find(null, /^Total Vehicles$/i, /^Vehicles$/i),
    missing: [["cash", cash], ["receivables", ar], ["payables", ap], ["current assets", ca], ["current liabilities", cl]].filter(x => x[1] == null).map(x => x[0])
  };
}

export function readProfitAndLoss(rep) {
  const ix = indexReport(rep);
  const income = ix.find("Income", /^Total Income$/i);
  const cogs = ix.find("COGS", /^Total Cost of (Goods Sold|Sales)$/i);
  const gp = ix.find("GrossProfit", /^Gross Profit$/i);
  const expenses = ix.find("Expenses", /^Total Expenses$/i);
  return {
    income, cogs,
    gp: gp != null ? gp : (income != null && cogs != null ? income - cogs : null),
    expenses,
    payroll: ix.find(null, /^Total .*Payroll Expenses$/i),
    labour: ix.sumWhere(/labou?r\s+cos/i),
    consulting: ix.find(null, /Consulting Fees$/i),
    missing: [["income", income], ["cost of sales", cogs], ["expenses", expenses]].filter(x => x[1] == null).map(x => x[0])
  };
}

/* ------------------------------------------------- bills, line by line
   The payables detail report lists every unpaid bill with its due date, which
   the summary cannot give. Columns are found by their titles, not positions. */
export function readPayableDetail(rep) {
  const cols = colsOf(rep);
  const at = name => cols.indexOf(name);
  const iDate = at("date"), iType = at("transactiontype"), iNum = at("num"), iVendor = at("vendor"),
        iDue = at("duedate"), iAmt = at("amount"), iOpen = at("openbalance");
  const bills = [];
  const walk = rows => {
    for (const r of rows) {
      if (r.ColData && r.type !== "Section") {
        const c = r.ColData, v = i => (i >= 0 && c[i]) ? c[i].value : "";
        const vendor = v(iVendor);
        if (!vendor || /^total\b/i.test(String(v(0)))) continue;
        bills.push({ vendor: String(vendor), type: String(v(iType)), num: String(v(iNum)), date: String(v(iDate)),
          due: String(v(iDue) || v(iDate)), amount: num(v(iAmt)), open: num(v(iOpen) || v(iAmt)) });
      }
      if (r.Rows) walk(rowsOf(r));
    }
  };
  walk(rowsOf(rep));
  return bills;
}

/* ------------------------------------------------ spend by supplier */
export function readVendorSpend(rep) {
  const out = [];
  const walk = rows => {
    for (const r of rows) {
      if (r.group === "GrandTotal") continue;
      if (r.type === "Section" && r.Summary) {
        const name = (r.Header && r.Header.ColData && r.Header.ColData[0] && r.Header.ColData[0].value) || "";
        const c = r.Summary.ColData;
        if (name) out.push({ vendor: String(name), amount: num(c[c.length - 1].value) });
        continue;
      }
      if (r.ColData) {
        const name = String((r.ColData[0] && r.ColData[0].value) || "");
        if (name && !/^total\b/i.test(name)) out.push({ vendor: name, amount: num(r.ColData[r.ColData.length - 1].value) });
      }
    }
  };
  walk(rowsOf(rep));
  return out.sort((a, b) => b.amount - a.amount);
}
