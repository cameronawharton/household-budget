// In-memory stand-in for supabase-js, just enough for UI testing.
(function () {
  const db = { members: [{ email: "cameron@test.com" }], settings: [{ id: 1, paycheck: 3020, first_payday: "2026-11-20", starting_balance: 2500, horizon_months: 14 }], bills: [], schedule: [], transactions: [] };
  const ids = { bills: 0, schedule: 0, transactions: 0 };
  const B = (name, kind, category, amount, due_day, extra = {}) => db.bills.push({ id: ++ids.bills, name, kind, category, amount, due_day, months: null, remaining: null, remaining_as_of: null, active: true, sort: ids.bills, notes: null, ...extra });
  B("Child support (start of month)", "income", "Income", 1303.84, 1); B("Child support (mid-month, 3 deposits)", "income", "Income", 1268.84, 15);
  B("House Note", "monthly", "Housing", 1977.37, 1); B("Brinks Alarm", "monthly", "Home", 91.67, 9); B("Gas", "monthly", "Utilities", 100, 13);
  B("Xfinity Mobile", "monthly", "Telecom", 76.64, 13); B("Electricity", "monthly", "Utilities", 300, 15); B("Apple Storage", "monthly", "Subscriptions", 10, 15);
  B("Claude Pro", "monthly", "Subscriptions", 20, 15); B("Google Photos", "monthly", "Subscriptions", 10, 15); B("Walden HOA", "monthly", "Housing", 148.38, 16);
  B("Home Internet", "monthly", "Telecom", 135.27, 22); B("MUD (Water)", "monthly", "Utilities", 100, 26); B("AT&T", "monthly", "Telecom", 289.17, 27);
  B("Spotify Family", "monthly", "Subscriptions", 23.58, 27); B("Groceries", "allowance", "Groceries", 1000, null); B("Fuel", "allowance", "Fuel", 200, null);
  B("Pets", "allowance", "Pets", 200, null); B("Toll Road", "allowance", "Toll Road", 40, null);
  B("Car Insurance", "annual", "Insurance", 1000, 1, { months: [1, 7] }); B("HOA Annual Dues", "annual", "Housing", 460, 1, { months: [1] });
  B("Wedding Ring", "debt", "Debt", 520, 5, { remaining: 968, remaining_as_of: "2026-11-17" });
  const tx = (date, who, category, amount, note) => db.transactions.push({ id: ++ids.transactions, date, who, category, amount, note });
  tx("2026-11-15", "Amber", "Groceries", 182.4, "HEB"); tx("2026-11-16", "Cameron", "Fuel", 48.1, null); tx("2026-11-17", "Amber", "Dining Out", 36.75, "Tacos");
  window.__db = db; window.__calls = [];
  const listeners = [];
  function Q(table) {
    const st = { table, op: "select", filters: [], orders: [], range: null, single: false, maybe: false, head: false, payload: null, returning: false };
    const q = {
      select(cols, opts) { if (st.op === "select") { st.head = !!(opts && opts.head); } else st.returning = true; return q; },
      order(c) { st.orders.push(c); return q; }, range(a, b) { st.range = [a, b]; return q; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return q; }, in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return q; },
      single() { st.single = true; return q; }, maybeSingle() { st.maybe = true; return q; },
      insert(p) { st.op = "insert"; st.payload = Array.isArray(p) ? p : [p]; return q; },
      update(p) { st.op = "update"; st.payload = p; return q; }, delete() { st.op = "delete"; return q; },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    function exec() {
      window.__calls.push(st.op + " " + table);
      const rows = db[table]; const match = (r) => st.filters.every((f) => f(r));
      if (st.op === "select") {
        let out = rows.filter(match);
        if (st.head) return { count: out.length, data: null, error: null };
        out = out.slice().sort((a, b) => { for (const o of st.orders) { if (a[o] < b[o]) return -1; if (a[o] > b[o]) return 1; } return 0; });
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        if (st.maybe) return { data: out[0] || null, error: null };
        return { data: JSON.parse(JSON.stringify(out)), error: null };
      }
      if (st.op === "insert") {
        const made = st.payload.map((p) => { const r = { actual: null, paid: false, ...p, id: ++ids[table] }; rows.push(r); return r; });
        notify(table);
        return { data: st.single ? made[0] : made, error: null };
      }
      if (st.op === "update") { rows.filter(match).forEach((r) => Object.assign(r, st.payload)); notify(table); return { data: null, error: null }; }
      if (st.op === "delete") { db[table] = rows.filter((r) => !match(r)); notify(table); return { data: null, error: null }; }
    }
    return q;
  }
  function notify(table) { setTimeout(() => listeners.filter((l) => l.t === table).forEach((l) => l.cb({})), 10); }
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { email: "cameron@test.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: { session: { user: { email: "cameron@test.com" } } }, error: null }),
      signOut: async () => ({}),
    },
    from: (t) => Q(t),
    channel: () => { const ch = { on(_e, f, cb) { listeners.push({ t: f.table, cb }); return ch; }, subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 20); return ch; } }; return ch; },
    removeChannel() {},
  }) };
})();
