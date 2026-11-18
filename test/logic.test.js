const L = require("../app/logic.js");
const py = require("./fixtures/sheet-2026-11-17.json");
const settings = { paycheck: 3020, first_payday: "2026-11-20", starting_balance: 0, horizon_months: 14 };
let id = 1;
const B = (name, kind, category, amount, due_day, extra = {}) => ({ id: id++, name, kind, category, amount, due_day, active: true, ...extra });
const bills = [
  B("Child support (start of month)", "income", "Income", 1303.84, 1),
  B("Child support (mid-month, 3 deposits)", "income", "Income", 1268.84, 15),
  B("House Note", "monthly", "Housing", 1977.37, 1), B("Brinks Alarm", "monthly", "Home", 91.67, 9),
  B("Gas", "monthly", "Utilities", 100, 13), B("Xfinity Mobile", "monthly", "Telecom", 76.64, 13),
  B("Electricity", "monthly", "Utilities", 300, 15), B("Apple Storage", "monthly", "Subscriptions", 10, 15),
  B("Claude Pro", "monthly", "Subscriptions", 20, 15), B("Google Photos", "monthly", "Subscriptions", 10, 15),
  B("Walden HOA", "monthly", "Housing", 148.38, 16), B("Home Internet", "monthly", "Telecom", 135.27, 22),
  B("MUD (Water)", "monthly", "Utilities", 100, 26), B("AT&T", "monthly", "Telecom", 289.17, 27),
  B("Spotify Family", "monthly", "Subscriptions", 23.58, 27),
  B("Groceries", "allowance", "Groceries", 1000, null), B("Fuel", "allowance", "Fuel", 200, null),
  B("Pets", "allowance", "Pets", 200, null), B("Toll Road", "allowance", "Toll Road", 40, null),
  B("Car Insurance", "annual", "Insurance", 1000, 1, { months: [1, 7] }), B("HOA Annual Dues", "annual", "Housing", 460, 1, { months: [1] }),
  B("Wedding Ring", "debt", "Debt", 520, 5, { remaining: 968, remaining_as_of: "2026-11-17" }),
];
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } };

// 1. same window as the spreadsheet: Nov 20 2026 through Jan 12 2028
const sched = L.generateSchedule({ settings, bills, from: "2026-11-20", to: "2028-01-12" });
ok(sched.length === 359, "row count " + sched.length);
const periods = L.computePeriods(settings, sched);
ok(periods.length === py.periods.length, "period count");
periods.forEach((p, i) => {
  const q = py.periods[i];
  ok(p.payday === q.payday && p.inn === q.inn && p.out === q.out && p.running === q.bal, `period ${p.payday}: ${p.inn}/${p.out}/${p.running} vs ${q.inn}/${q.out}/${q.bal}`);
});
const ring = sched.filter((r) => r.bill_id === 22).map((r) => `${r.date} ${r.item} ${r.planned}`);
ok(JSON.stringify(ring) === JSON.stringify(["2026-12-05 Wedding Ring 520", "2027-01-05 Wedding Ring (final) 448"]), "ring " + ring);

// 2. actual amounts override planned
const s2 = sched.map((r) => ({ ...r }));
s2.find((r) => r.date === "2026-12-15" && r.item === "Electricity").actual = 380;
ok(L.computePeriods(settings, s2)[1].out === L.round2(py.periods[1].out + 80), "actual override");

// 3. rebuild keeps paid rows and does not double-pay the debt
const keep = sched.filter((r) => r.date < "2026-12-10").map((r) => ({ ...r, paid: true }));
const regen = L.generateSchedule({ settings, bills, from: "2026-12-10", to: "2028-01-12", keep });
const combined = L.sortRows([...keep, ...regen]);
ok(combined.length === 359, "rebuild row count " + combined.length);
ok(L.computePeriods(settings, combined).every((p, i) => p.running === py.periods[i].bal), "rebuild totals");
const ring2 = combined.filter((r) => r.bill_id === 22).length;
ok(ring2 === 2, "ring after rebuild " + ring2);

// 4. horizon and due day clamping
ok(L.horizonEnd(settings, "2026-11-20") === "2028-01-27", "horizon " + L.horizonEnd(settings, "2026-11-20"));
const feb = L.generateSchedule({ settings, bills: [B("Test", "monthly", "X", 1, 31)], from: "2027-02-01", to: "2027-02-28" });
ok(feb.some((r) => r.date === "2027-02-28" && r.item === "Test"), "clamp 31st to Feb 28");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
