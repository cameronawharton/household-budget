// Pure budgeting logic: dates, schedule generation, pay periods, monthly rollups.
// Works in the browser (window.BudgetLogic) and in Node (module.exports) for testing.
(function (root) {
  "use strict";

  // ---------- dates (ISO strings 'YYYY-MM-DD', handled in UTC) ----------
  const toDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const toIso = (dt) => dt.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
  const addMonths = (iso, n) => {
    const d = toDate(iso);
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1 + n;
    y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
    const day = Math.min(d.getUTCDate(), daysInMonth(y, m));
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const monthKey = (iso) => iso.slice(0, 7);
  const todayIso = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const num = (x) => (x === null || x === undefined || x === "" ? 0 : Number(x));
  const amountOf = (row) => (row.actual !== null && row.actual !== undefined && row.actual !== "" ? Number(row.actual) : Number(row.planned));

  // ---------- paydays ----------
  function paydaysBetween(firstPayday, from, to) {
    const out = [];
    let p = firstPayday;
    while (p <= to) { if (p >= from) out.push(p); p = addDays(p, 14); }
    return out;
  }
  function periodStartFor(firstPayday, iso) {
    const diff = Math.floor((toDate(iso) - toDate(firstPayday)) / 86400000);
    const k = Math.floor(diff / 14);
    return addDays(firstPayday, k * 14);
  }
  // End date of the schedule horizon: horizon months past `from`, stretched to finish a pay period.
  function horizonEnd(settings, from) {
    const end = addMonths(from, Number(settings.horizon_months || 14));
    return addDays(periodStartFor(settings.first_payday, end), 13);
  }

  const perPaycheck = (monthly) => round2(Number(monthly) * 12 / 26);

  // ---------- schedule generation ----------
  // keep: rows already in the schedule that must not be regenerated (past, paid, or edited).
  function generateSchedule({ settings, bills, from, to, keep = [] }) {
    const active = bills.filter((b) => b.active !== false);
    const rows = [];
    const keepKeys = new Set(keep.map((r) => `${r.item}|${r.date}`));
    const push = (r) => { if (!keepKeys.has(`${r.item}|${r.date}`)) rows.push(r); };

    // paychecks and per-paycheck spending budgets
    for (const pd of paydaysBetween(settings.first_payday, from, to)) {
      push({ date: pd, item: "Paycheck", direction: "in", category: "Income", planned: Number(settings.paycheck), bill_id: null });
      for (const b of active.filter((x) => x.kind === "allowance")) {
        push({ date: pd, item: `${b.name} (spending)`, direction: "out", category: b.category, planned: perPaycheck(b.amount), bill_id: b.id });
      }
    }

    // debt balances still owed after rows we are keeping
    const debtLeft = {};
    for (const b of active.filter((x) => x.kind === "debt")) {
      const paidSoFar = keep
        .filter((r) => r.bill_id === b.id && (!b.remaining_as_of || r.date > b.remaining_as_of))
        .reduce((s, r) => s + amountOf(r), 0);
      debtLeft[b.id] = round2(num(b.remaining) - paidSoFar);
    }

    // dated bills and deposits
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dt = toDate(d);
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, day = dt.getUTCDate();
      const dim = daysInMonth(y, m);
      const hits = (b) => b.due_day && Math.min(Number(b.due_day), dim) === day;
      for (const b of active) {
        if (!hits(b)) continue;
        if (b.kind === "income") {
          push({ date: d, item: b.name, direction: "in", category: b.category, planned: Number(b.amount), bill_id: b.id });
        } else if (b.kind === "monthly") {
          push({ date: d, item: b.name, direction: "out", category: b.category, planned: Number(b.amount), bill_id: b.id });
        } else if (b.kind === "annual") {
          const months = (b.months || []).map(Number);
          if (months.includes(m)) push({ date: d, item: b.name, direction: "out", category: b.category, planned: Number(b.amount), bill_id: b.id });
        } else if (b.kind === "debt") {
          if (b.remaining_as_of && d <= b.remaining_as_of) continue;
          const left = debtLeft[b.id];
          if (left > 0.004) {
            const pay = round2(Math.min(Number(b.amount), left));
            debtLeft[b.id] = round2(left - pay);
            const item = debtLeft[b.id] <= 0.004 ? `${b.name} (final)` : b.name;
            push({ date: d, item, direction: "out", category: b.category, planned: pay, bill_id: b.id });
          }
        }
      }
    }
    return sortRows(rows);
  }

  function sortRows(rows) {
    return rows.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      a.direction !== b.direction ? (a.direction === "in" ? -1 : 1) :
      a.item < b.item ? -1 : a.item > b.item ? 1 : 0);
  }

  // ---------- pay periods ----------
  function computePeriods(settings, schedule) {
    if (!schedule.length) return [];
    const last = schedule.reduce((mx, r) => (r.date > mx ? r.date : mx), schedule[0].date);
    const paydays = paydaysBetween(settings.first_payday, settings.first_payday, last);
    const byStart = {};
    for (const r of schedule) {
      if (r.date < settings.first_payday) continue;
      const s = periodStartFor(settings.first_payday, r.date);
      (byStart[s] = byStart[s] || []).push(r);
    }
    let running = num(settings.starting_balance);
    return paydays.map((pd) => {
      const rows = byStart[pd] || [];
      const inn = round2(rows.filter((r) => r.direction === "in").reduce((s, r) => s + amountOf(r), 0));
      const out = round2(rows.filter((r) => r.direction === "out").reduce((s, r) => s + amountOf(r), 0));
      const net = round2(inn - out);
      running = round2(running + net);
      const hasSupport = rows.some((r) => r.direction === "in" && r.item !== "Paycheck");
      return { payday: pd, through: addDays(pd, 13), inn, out, net, running, rows, hasSupport };
    });
  }

  // ---------- monthly spending vs budget ----------
  function monthlySpending(transactions, bills) {
    const budgetCats = bills.filter((b) => b.kind === "allowance" && b.active !== false)
      .map((b) => ({ category: b.category, budget: Number(b.amount) }));
    const months = {};
    for (const t of transactions) {
      const k = monthKey(t.date);
      months[k] = months[k] || {};
      months[k][t.category] = round2((months[k][t.category] || 0) + Number(t.amount));
    }
    return { budgetCats, months };
  }

  const api = {
    toDate, toIso, addDays, addMonths, daysInMonth, monthKey, todayIso, round2, amountOf,
    paydaysBetween, periodStartFor, horizonEnd, perPaycheck, generateSchedule, sortRows,
    computePeriods, monthlySpending,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BudgetLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
