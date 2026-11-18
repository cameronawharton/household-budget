/* Household Budget desktop app (renderer). Talks to Supabase for shared, live data. */
(function () {
  "use strict";
  const L = window.BudgetLogic;
  const root = document.getElementById("root");
  const CATS = ["Groceries", "Fuel", "Pets", "Toll Road", "Dining Out", "Household", "Kids", "Gifts", "Medical", "Car", "Entertainment", "Other"];
  const PEOPLE = ["Cameron", "Amber"];
  const KINDS = { income: "Income", monthly: "Monthly bill", allowance: "Spending budget", annual: "Yearly / twice yearly", debt: "Paying down" };
  const NAV = [
    ["dashboard", "Dashboard", "◎"], ["periods", "Pay Periods", "▤"], ["schedule", "Schedule", "☷"],
    ["spending", "Spending Log", "✎"], ["monthly", "Monthly Budget", "▦"], ["bills", "Bills & Income", "≡"], ["settings", "Settings", "⚙"],
  ];
  const LS = {
    get custom() { return localStorage.getItem("hb.custom") === "1"; },
    get url() { return localStorage.getItem("hb.url") || (this.custom ? "" : (window.HB_CONFIG || {}).url) || ""; }, set url(v) { localStorage.setItem("hb.url", v); },
    get key() { return localStorage.getItem("hb.key") || (this.custom ? "" : (window.HB_CONFIG || {}).key) || ""; }, set key(v) { localStorage.setItem("hb.key", v); },
    get me() { return localStorage.getItem("hb.me") || ""; }, set me(v) { localStorage.setItem("hb.me", v); },
  };

  const S = {
    sb: null, session: null, channel: null, live: false,
    settings: null, bills: [], schedule: [], transactions: [],
    view: "dashboard", schedMonth: null, schedFilter: "all", txMonth: null, openPeriod: null,
    billsDirty: false, pendingRender: false, busy: false,
    version: "", update: null, updatePct: null, updateErr: null,
  };

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (x) => { const n = Number(x) || 0; const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" }); return n < 0 ? "-" + s : s; };
  const dfmt = (iso, opts) => L.toDate(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  const dShort = (iso) => dfmt(iso, { weekday: "short", month: "short", day: "numeric" });
  const dMed = (iso) => dfmt(iso, { month: "short", day: "numeric", year: "numeric" });
  const monthLabel = (ym) => dfmt(ym + "-01", { month: "long", year: "numeric" });
  const shiftMonth = (ym, n) => L.addMonths(ym + "-01", n).slice(0, 7);
  const isSpend = (r) => / \(spending\)$/.test(r.item);
  const budgetCats = () => S.bills.filter((b) => b.kind === "allowance" && b.active !== false).map((b) => b.category);
  let toastTimer;
  function toast(msg, err) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast" + (err ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), err ? 5000 : 2200);
  }
  async function run(promise, okMsg) {
    const { data, error } = await promise;
    if (error) { console.error(error); toast(error.message || "Something went wrong", true); return null; }
    if (okMsg) toast(okMsg);
    return data ?? true;
  }
  const fromAmount = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isNaN(n) ? null : Math.round(n * 100) / 100; };

  // ---------------------------------------------------------------- boot / auth
  async function boot() {
    try { S.version = window.appInfo?.getVersion ? await window.appInfo.getVersion() : ""; } catch (_) { S.version = ""; }
    if (!LS.url || !LS.key) return renderSetup();
    try {
      S.sb = window.supabase.createClient(LS.url, LS.key, { auth: { persistSession: true, autoRefreshToken: true } });
    } catch (e) { return renderSetup("That connection didn't work: " + e.message); }
    S.sb.auth.onAuthStateChange((event, session) => {
      S.session = session;
      if (event === "SIGNED_OUT") { teardown(); renderLogin(); }
    });
    const { data } = await S.sb.auth.getSession();
    S.session = data.session;
    if (!S.session) return renderLogin();
    start();
  }

  function renderSetup(err) {
    root.innerHTML = `
      <div class="center"><form class="auth" data-form="setup">
        <img src="icon.png" width="44" height="44" alt="" />
        <h1>Connect your budget</h1>
        <p>In your Supabase project, click <b>Connect</b> at the top of the dashboard and copy the Project URL and the publishable key. You only do this once on each computer.</p>
        <label>Project URL</label><input type="text" name="url" placeholder="https://abcd1234.supabase.co" value="${esc(LS.url)}" required />
        <label>Publishable key</label><input type="password" name="key" placeholder="sb_publishable_..." value="${esc(LS.key)}" required />
        <button class="btn primary" type="submit">Save and continue</button>
        ${err ? `<div class="err">${esc(err)}</div>` : ""}
      </form></div>`;
  }

  function renderLogin(err) {
    root.innerHTML = `
      <div class="center"><form class="auth" data-form="login">
        <img src="icon.png" width="44" height="44" alt="" />
        <h1>Household Budget</h1>
        <p>Sign in with the account set up for you in Supabase.</p>
        <label>Email</label><input type="email" name="email" autocomplete="username" required autofocus />
        <label>Password</label><input type="password" name="password" autocomplete="current-password" required />
        <button class="btn primary" type="submit">Sign in</button>
        ${err ? `<div class="err">${esc(err)}</div>` : ""}
        <div class="row" style="justify-content:center;margin-top:10px"><button type="button" class="btn link small" data-act="change-connection">Change Supabase connection</button></div>
      </form></div>`;
  }

  function renderWho() {
    root.innerHTML = `
      <div class="center"><div class="auth">
        <img src="icon.png" width="44" height="44" alt="" />
        <h1>Who uses this computer?</h1>
        <p>Spending you log here will be tagged with this name. You can change it later in Settings.</p>
        <div class="who">${PEOPLE.map((p) => `<button class="btn" data-act="set-me" data-name="${p}">${p}</button>`).join("")}</div>
      </div></div>`;
  }

  function renderMessage(title, body, withSignOut) {
    root.innerHTML = `<div class="center"><div class="auth"><img src="icon.png" width="44" height="44" alt="" />
      <h1>${esc(title)}</h1><p>${body}</p>
      ${withSignOut ? `<button class="btn" data-act="sign-out">Sign out</button>` : ""}</div></div>`;
  }

  async function start() {
    if (!LS.me) return renderWho();
    renderMessage("Loading your budget", "One moment.");
    const members = await run(S.sb.from("members").select("email"));
    if (members === null) return renderMessage("Can't reach the database", "Check your internet connection, or that the setup script was run in Supabase. Press Ctrl+R to try again.", true);
    if (!members.length) return renderMessage("This account isn't on the list", `Signed in as <b>${esc(S.session.user.email)}</b>, but that email isn't in the <b>members</b> table in Supabase. Add it there, then sign in again.`, true);
    await loadAll();
    if (!S.settings) return renderMessage("Setup isn't finished", "The settings row is missing. Run the setup script in the Supabase SQL Editor, then press Ctrl+R.", true);
    if (!S.schedule.length) await initialGenerate();
    subscribe();
    render();
    checkForUpdate(false);
    clearInterval(S.updateTimer); S.updateTimer = setInterval(() => checkForUpdate(false), 6 * 60 * 60 * 1000);
  }

  function teardown() {
    if (S.channel) { S.sb.removeChannel(S.channel); S.channel = null; }
    S.live = false; S.settings = null; S.bills = []; S.schedule = []; S.transactions = [];
  }

  // ---------------------------------------------------------------- data
  async function fetchAll(table, orders) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = S.sb.from(table).select("*");
      for (const o of orders) q = q.order(o, { ascending: true });
      const { data, error } = await q.range(from, from + 999);
      if (error) { toast(error.message, true); return out; }
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  const loaders = {
    settings: async () => { const { data } = await S.sb.from("settings").select("*").eq("id", 1).maybeSingle(); S.settings = data; },
    bills: async () => { S.bills = await fetchAll("bills", ["sort", "id"]); },
    schedule: async () => { S.schedule = await fetchAll("schedule", ["date", "id"]); },
    transactions: async () => { S.transactions = await fetchAll("transactions", ["date", "id"]); },
  };
  async function loadAll() { await Promise.all(Object.values(loaders).map((f) => f())); }

  async function insertChunks(table, rows) {
    for (let i = 0; i < rows.length; i += 300) {
      const ok = await run(S.sb.from(table).insert(rows.slice(i, i + 300)));
      if (ok === null) return false;
    }
    return true;
  }

  async function initialGenerate() {
    const { count } = await S.sb.from("schedule").select("id", { count: "exact", head: true });
    if (count) return loaders.schedule();
    const from = S.settings.first_payday;
    const start = L.todayIso() > from ? L.todayIso() : from;
    const rows = L.generateSchedule({ settings: S.settings, bills: S.bills, from, to: L.horizonEnd(S.settings, start) });
    await insertChunks("schedule", rows.map((r) => ({ ...r, source: "generated" })));
    await loaders.schedule();
  }

  // Regenerate everything from today forward that nobody has touched (unpaid, no actual, not manual).
  async function rebuildSchedule() {
    if (S.busy) return;
    S.busy = true; render();
    try {
      await Promise.all([loaders.settings(), loaders.bills(), loaders.schedule()]);
      const today = L.todayIso();
      const from = today > S.settings.first_payday ? today : S.settings.first_payday;
      const untouched = (r) => r.date >= from && !r.paid && (r.actual === null || r.actual === undefined) && r.source === "generated";
      const drop = S.schedule.filter(untouched).map((r) => r.id);
      const keep = S.schedule.filter((r) => !untouched(r));
      for (let i = 0; i < drop.length; i += 200) {
        if ((await run(S.sb.from("schedule").delete().in("id", drop.slice(i, i + 200)))) === null) throw new Error("delete failed");
      }
      const fresh = L.generateSchedule({ settings: S.settings, bills: S.bills, from, to: L.horizonEnd(S.settings, from), keep });
      await insertChunks("schedule", fresh.map((r) => ({ ...r, source: "generated" })));
      await loaders.schedule();
      S.billsDirty = false;
      toast("Schedule updated");
    } catch (e) { console.error(e); } finally { S.busy = false; render(); }
  }

  // ---------------------------------------------------------------- live sync
  const reloadTimers = {};
  function subscribe() {
    if (S.channel) S.sb.removeChannel(S.channel);
    let ch = S.sb.channel("household-budget");
    for (const t of Object.keys(loaders)) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        clearTimeout(reloadTimers[t]);
        reloadTimers[t] = setTimeout(async () => { await loaders[t](); safeRender(); }, 350);
      });
    }
    S.channel = ch.subscribe((status) => { S.live = status === "SUBSCRIBED"; renderFoot(); });
  }
  // Don't yank the screen out from under someone mid-typing; render when they leave the field.
  function safeRender() {
    const a = document.activeElement;
    if (a && a.closest && a.closest(".main") && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) { S.pendingRender = true; return; }
    render();
  }
  document.addEventListener("focusout", () => setTimeout(() => {
    if (S.pendingRender && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) { S.pendingRender = false; render(); }
  }, 50));

  // ---------------------------------------------------------------- render shell
  function render() {
    if (!S.settings) return;
    const scrollEl = root.querySelector(".main");
    const scroll = scrollEl ? scrollEl.scrollTop : 0;
    const view = { dashboard: viewDashboard, periods: viewPeriods, schedule: viewSchedule, spending: viewSpending, monthly: viewMonthly, bills: viewBills, settings: viewSettings }[S.view];
    root.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand"><img src="icon.png" alt="" /><b>Household<br/>Budget</b></div>
          <nav class="nav">${NAV.map(([k, label, ico]) => `<button class="${S.view === k ? "active" : ""}" data-act="nav" data-view="${k}"><span class="ico">${ico}</span>${label}</button>`).join("")}</nav>
          <div class="foot" id="foot"></div>
        </aside>
        <main class="main">${updateBanner()}${view()}</main>
      </div>`;
    renderFoot();
    const m = root.querySelector(".main"); if (m) m.scrollTop = scroll;
  }
  function renderFoot() {
    const f = document.getElementById("foot");
    if (!f) return;
    f.innerHTML = `<div class="live"><span class="dot ${S.live ? "on" : ""}"></span>${S.live ? "Live: changes sync" : "Connecting..."}</div>
      <div style="margin-top:6px">Signed in as ${esc(LS.me)}</div><div class="muted" style="color:#7f93a5">v${esc(S.version || "")}</div>`;
  }
  const head = (title, sub, right = "") => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div><div class="row">${right}</div></div>`;

  // ---------------------------------------------------------------- views
  function currentPeriods() {
    const periods = L.computePeriods(S.settings, S.schedule);
    const today = L.todayIso();
    let idx = periods.findIndex((p) => p.payday <= today && today <= p.through);
    if (idx < 0) idx = today < (periods[0]?.payday || today) ? 0 : periods.length - 1;
    return { periods, idx, cur: periods[idx], today };
  }
  const isTight = (p) => p.net < 500;

  function viewDashboard() {
    const { periods, idx, cur, today } = currentPeriods();
    if (!cur) return head("Dashboard") + `<div class="card empty">No schedule yet.</div>`;
    const cats = budgetCats();
    const spendBudget = cur.rows.filter(isSpend).reduce((s, r) => s + L.amountOf(r), 0);
    const spent = S.transactions.filter((t) => t.date >= cur.payday && t.date <= cur.through && cats.includes(t.category)).reduce((s, t) => s + Number(t.amount), 0);
    const spendLeft = L.round2(spendBudget - spent);
    const pct = spendBudget ? Math.min(100, Math.round((spent / spendBudget) * 100)) : 0;
    const dueRows = cur.rows.filter((r) => r.direction === "out" && !isSpend(r) && !r.paid && r.date >= today);
    const due = dueRows.reduce((s, r) => s + L.amountOf(r), 0);
    const upcoming = S.schedule.filter((r) => r.date >= today && r.date <= L.addDays(today, 14) && !isSpend(r));
    const ahead = periods.slice(idx + 1, idx + 9).filter((p) => isTight(p) || !p.hasSupport);
    const recent = [...S.transactions].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1)).slice(0, 6);
    const lastDate = S.schedule.length ? S.schedule[S.schedule.length - 1].date : today;
    const needsExtend = lastDate < L.addMonths(today, Math.max(3, Number(S.settings.horizon_months) - 3));

    return head("Dashboard", `Pay period ${dShort(cur.payday)} to ${dShort(cur.through)}`, `<span class="muted">Today is ${dfmt(today, { weekday: "long", month: "long", day: "numeric" })}</span>`) + `
      ${needsExtend ? `<div class="banner"><span>The schedule runs out on ${dMed(lastDate)}. Extend it to keep planning ${esc(S.settings.horizon_months)} months ahead.</span><button class="btn small" data-act="rebuild" ${S.busy ? "disabled" : ""}>${S.busy ? "Working..." : "Extend schedule"}</button></div>` : ""}
      ${S.billsDirty ? dirtyBanner() : ""}
      <div class="grid g4">
        <div class="card stat"><div class="label">Left over this pay period</div><div class="value ${cur.net < 0 ? "neg" : cur.net < 500 ? "warn" : "pos"}">${money(cur.net)}</div><div class="note">${money(cur.inn)} in, ${money(cur.out)} out</div></div>
        <div class="card stat"><div class="label">Spending money left</div><div class="value ${spendLeft < 0 ? "neg" : ""}">${money(spendLeft)}</div>
          <div class="bar ${spendLeft < 0 ? "over" : ""}"><span style="width:${pct}%"></span></div><div class="note">${money(spent)} logged of ${money(spendBudget)} for groceries, fuel, pets, toll</div></div>
        <div class="card stat"><div class="label">Bills still due this period</div><div class="value">${money(due)}</div><div class="note">${dueRows.length} unpaid through ${dShort(cur.through)}</div></div>
        <div class="card stat"><div class="label">Projected balance at period end</div><div class="value">${money(cur.running)}</div><div class="note">${Number(S.settings.starting_balance) ? "Starting balance plus every period so far" : "Set your starting balance in Settings to make this real"}</div></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h2>Next 14 days <small>check off as they clear</small></h2>
          <div class="list">${upcoming.length ? upcoming.map(liRow).join("") : `<div class="empty">Nothing scheduled.</div>`}</div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card"><h2>Log spending</h2>${quickForm()}</div>
          <div class="card"><h2>Heads up <small>next 8 pay periods</small></h2>
            ${ahead.length ? ahead.map((p) => `<div class="alert"><b>${dShort(p.payday)}</b><span>${p.net < 0 ? `Short by ${money(-p.net)}. Hold money back from the period before.` : isTight(p) ? `Only ${money(p.net)} left over.` : ""} ${!p.hasSupport ? "No child support lands in this period." : ""}</span></div>`).join("") : `<div class="muted">Nothing tight coming up.</div>`}
          </div>
          <div class="card"><h2>Recent spending <button class="btn link small" data-act="nav" data-view="spending">See all</button></h2>
            ${recent.length ? `<table>${recent.map((t) => `<tr><td class="small muted">${dShort(t.date)}</td><td>${esc(t.category)}${t.note ? ` <span class="muted small">${esc(t.note)}</span>` : ""}</td><td class="small muted">${esc(t.who)}</td><td class="num">${money(t.amount)}</td></tr>`).join("")}</table>` : `<div class="muted">Nothing logged yet.</div>`}
          </div>
        </div>
      </div>`;
  }
  function liRow(r) {
    const cls = r.direction === "in" ? "in" : "out";
    return `<div class="li ${r.paid ? "paid" : ""}"><span class="d">${dShort(r.date)}</span>
      <span class="name">${esc(r.item)} <span class="pill ${cls}">${r.direction === "in" ? "In" : esc(r.category)}</span></span>
      <span class="amt ${r.direction === "in" ? "pos" : ""}">${money(L.amountOf(r))}</span>
      <input type="checkbox" title="${r.direction === "in" ? "Received" : "Paid"}" data-change="paid" data-id="${r.id}" ${r.paid ? "checked" : ""} /></div>`;
  }
  function quickForm(wide) {
    return `<form class="quick ${wide ? "wide" : ""}" data-form="tx">
      <input type="date" name="date" value="${L.todayIso()}" required />
      <select name="who">${PEOPLE.map((p) => `<option ${p === LS.me ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select name="category">${CATS.map((c) => `<option>${c}</option>`).join("")}</select>
      <input class="span2" type="text" name="note" placeholder="Note (optional)" />
      <input type="text" name="amount" placeholder="$0.00" inputmode="decimal" required />
      <button class="btn green span3" type="submit">Add</button></form>`;
  }
  const dirtyBanner = () => `<div class="banner"><span>Bills or settings changed. Update the schedule so pay periods reflect it. Paid and edited items are kept.</span><button class="btn small" data-act="rebuild" ${S.busy ? "disabled" : ""}>${S.busy ? "Working..." : "Update schedule"}</button></div>`;

  function viewPeriods() {
    const { periods, idx } = currentPeriods();
    return head("Pay Periods", "Each period runs from a payday to the day before the next one. Click a row to see what's in it.",
      `<span class="muted small">Starting balance ${money(S.settings.starting_balance)}</span>`) +
      (S.billsDirty ? dirtyBanner() : "") + `
      <div class="table-wrap"><table>
        <thead><tr><th>Payday</th><th>Covers</th><th class="num">Money in</th><th class="num">Money out</th><th class="num">Left over</th><th class="num">Running balance</th><th>Heads up</th></tr></thead>
        <tbody>${periods.map((p, i) => {
          const notes = [p.net < 0 ? "Short this period" : isTight(p) ? "Tight" : "", !p.hasSupport ? "No child support" : ""].filter(Boolean).join(". ");
          const open = S.openPeriod === p.payday;
          return `<tr class="${i === idx ? "current" : isTight(p) ? "tight" : ""} ${i < idx ? "done" : ""}" data-act="toggle-period" data-payday="${p.payday}" style="cursor:pointer">
            <td><b>${dShort(p.payday)}</b>${i === idx ? ` <span class="pill spend">Now</span>` : ""}</td><td class="muted">${dMed(p.payday)} to ${dMed(p.through)}</td>
            <td class="num pos">${money(p.inn)}</td><td class="num neg">${money(p.out)}</td>
            <td class="num"><b class="${p.net < 0 ? "neg" : isTight(p) ? "warn" : ""}">${money(p.net)}</b></td><td class="num">${money(p.running)}</td><td class="small warn">${notes}</td></tr>
            ${open ? `<tr><td colspan="7" style="background:#fafbfc;padding:6px 16px 12px">${periodDetail(p)}</td></tr>` : ""}`;
        }).join("")}</tbody></table></div>`;
  }
  function periodDetail(p) {
    return `<table>${L.sortRows([...p.rows]).map((r) => `<tr><td class="small muted" style="width:110px">${dShort(r.date)}</td><td>${esc(r.item)}</td>
      <td><span class="pill ${r.direction === "in" ? "in" : isSpend(r) ? "spend" : "out"}">${esc(r.category)}</span></td>
      <td class="num ${r.direction === "in" ? "pos" : ""}">${money(L.amountOf(r))}${r.actual !== null && r.actual !== undefined ? ` <span class="muted small">(planned ${money(r.planned)})</span>` : ""}</td>
      <td style="width:60px">${r.paid ? `<span class="pill gray">${r.direction === "in" ? "Received" : "Paid"}</span>` : ""}</td></tr>`).join("")}</table>`;
  }

  function viewSchedule() {
    const today = L.todayIso();
    if (!S.schedMonth) S.schedMonth = L.monthKey(today);
    let rows = S.schedule.filter((r) => L.monthKey(r.date) === S.schedMonth);
    if (S.schedFilter === "bills") rows = rows.filter((r) => !isSpend(r));
    if (S.schedFilter === "unpaid") rows = rows.filter((r) => !r.paid && !isSpend(r));
    const inn = rows.filter((r) => r.direction === "in").reduce((s, r) => s + L.amountOf(r), 0);
    const out = rows.filter((r) => r.direction === "out").reduce((s, r) => s + L.amountOf(r), 0);
    return head("Schedule", "Every dated bill and deposit. Type the real amount in Actual when it differs, and check items off as they clear.",
      monthPicker("sched", S.schedMonth) + `<select data-change="sched-filter">${[["all", "Everything"], ["bills", "Bills and deposits only"], ["unpaid", "Unpaid bills only"]].map(([v, l]) => `<option value="${v}" ${S.schedFilter === v ? "selected" : ""}>${l}</option>`).join("")}</select>`) +
      (S.billsDirty ? dirtyBanner() : "") + `
      <div class="row" style="margin-bottom:12px"><span class="pill in">In ${money(inn)}</span><span class="pill out">Out ${money(out)}</span><span class="muted small">for the rows shown</span></div>
      <div class="table-wrap" style="max-height:calc(100vh - 290px)"><table>
        <thead><tr><th>Date</th><th>Item</th><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th>Paid</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr class="${r.paid ? "done" : ""}">
          <td>${dShort(r.date)}</td><td>${esc(r.item)}${r.source === "manual" ? ` <span class="pill gray">added</span>` : ""}</td>
          <td><span class="pill ${r.direction === "in" ? "in" : isSpend(r) ? "spend" : "out"}">${esc(r.category)}</span></td>
          <td class="num">${money(r.planned)}</td>
          <td class="num"><input class="cell" type="text" inputmode="decimal" placeholder="same" value="${r.actual === null || r.actual === undefined ? "" : Number(r.actual).toFixed(2)}" data-change="actual" data-id="${r.id}" /></td>
          <td><input type="checkbox" data-change="paid" data-id="${r.id}" ${r.paid ? "checked" : ""} /></td>
          <td>${r.source === "manual" ? `<button class="btn link small danger" data-act="del-sched" data-id="${r.id}">Delete</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">Nothing this month.</td></tr>`}</tbody>
      </table></div>
      <div class="card" style="margin-top:16px"><h2>Add a one-time item <small>a bonus, a refund, a one-off bill</small></h2>
        <form class="row" data-form="manual">
          <input type="date" name="date" value="${S.schedMonth === L.monthKey(today) ? today : S.schedMonth + "-01"}" required />
          <input type="text" name="item" placeholder="What is it?" required style="flex:1;min-width:180px" />
          <select name="direction"><option value="out">Money out</option><option value="in">Money in</option></select>
          <input type="text" name="category" placeholder="Category" value="Other" style="width:130px" />
          <input type="text" name="amount" placeholder="$0.00" inputmode="decimal" required style="width:110px" />
          <button class="btn primary" type="submit">Add</button></form></div>`;
  }
  function monthPicker(key, ym) {
    return `<button class="btn small" data-act="month" data-key="${key}" data-step="-1">‹</button><b style="min-width:130px;text-align:center">${monthLabel(ym)}</b><button class="btn small" data-act="month" data-key="${key}" data-step="1">›</button><button class="btn small" data-act="month" data-key="${key}" data-step="0">This month</button>`;
  }

  function viewSpending() {
    if (!S.txMonth) S.txMonth = L.monthKey(L.todayIso());
    const rows = S.transactions.filter((t) => L.monthKey(t.date) === S.txMonth).sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
    const byCat = {}; rows.forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount)));
    const total = rows.reduce((s, t) => s + Number(t.amount), 0);
    return head("Spending Log", "Everyday spending either of you logs shows up here and on the other computer right away.", monthPicker("tx", S.txMonth)) + `
      <div class="card" style="margin-bottom:16px"><h2>Add spending</h2>${quickForm(true)}</div>
      <div class="row" style="margin-bottom:12px"><span class="pill out">Total ${money(total)}</span>${Object.entries(byCat).map(([c, v]) => `<span class="pill gray">${esc(c)} ${money(v)}</span>`).join("")}</div>
      <div class="table-wrap" style="max-height:calc(100vh - 330px)"><table>
        <thead><tr><th>Date</th><th>Who</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((t) => `<tr><td>${dShort(t.date)}</td><td>${esc(t.who)}</td><td>${esc(t.category)}</td><td class="muted">${esc(t.note || "")}</td>
          <td class="num">${money(t.amount)}</td><td style="width:70px"><button class="btn link small danger" data-act="del-tx" data-id="${t.id}">Delete</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Nothing logged for ${monthLabel(S.txMonth)}.</td></tr>`}</tbody>
      </table></div>`;
  }

  function viewMonthly() {
    const { budgetCats: bc, months } = L.monthlySpending(S.transactions, S.bills);
    const first = L.monthKey(S.settings.first_payday);
    const lastTx = S.transactions.reduce((mx, t) => (L.monthKey(t.date) > mx ? L.monthKey(t.date) : mx), first);
    const thisMonth = L.monthKey(L.todayIso());
    const end = [lastTx, thisMonth].sort().pop();
    const list = []; for (let m = first; m <= end; m = shiftMonth(m, 1)) list.push(m);
    const budgetTotal = bc.reduce((s, c) => s + c.budget, 0);
    return head("Monthly Budget", `Logged spending compared with the monthly budget (${money(budgetTotal)} across ${bc.map((c) => c.category.toLowerCase()).join(", ")}).`) + `
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th>${bc.map((c) => `<th class="num">${esc(c.category)}<br/><span style="font-weight:400">of ${money(c.budget)}</span></th>`).join("")}<th class="num">Everything else</th><th class="num">Total spent</th><th class="num">Left in budget</th></tr></thead>
        <tbody>${list.reverse().map((m) => {
          const mm = months[m] || {};
          const inBudget = bc.reduce((s, c) => s + (mm[c.category] || 0), 0);
          const all = Object.values(mm).reduce((s, v) => s + v, 0);
          const left = budgetTotal - inBudget;
          return `<tr class="${m === thisMonth ? "current" : ""}"><td><b>${monthLabel(m)}</b></td>
            ${bc.map((c) => { const v = mm[c.category] || 0; return `<td class="num ${v > c.budget ? "neg" : ""}">${money(v)}</td>`; }).join("")}
            <td class="num">${money(all - inBudget)}</td><td class="num"><b>${money(all)}</b></td><td class="num"><b class="${left < 0 ? "neg" : "pos"}">${money(left)}</b></td></tr>`;
        }).join("")}</tbody></table></div>`;
  }

  function viewBills() {
    const groups = Object.keys(KINDS);
    const cell = (b, field, val, cls = "", type = "text") => `<input class="cell ${cls}" type="${type}" value="${esc(val ?? "")}" data-change="bill" data-field="${field}" data-id="${b.id}" />`;
    return head("Bills & Income", "Change an amount or date here, then update the schedule. Anything already paid or edited stays as it is.",
      `<button class="btn primary" data-act="rebuild" ${S.busy ? "disabled" : ""}>${S.busy ? "Working..." : "Update schedule"}</button>`) +
      (S.billsDirty ? dirtyBanner() : "") +
      groups.map((k) => {
        const list = S.bills.filter((b) => b.kind === k);
        if (!list.length) return "";
        return `<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden"><h2 style="padding:14px 18px 0">${KINDS[k]} <small>${k === "allowance" ? "monthly amount, released evenly across paychecks" : k === "annual" ? "months as numbers, like 1,7 for January and July" : k === "debt" ? "payments stop once the remaining balance is paid" : ""}</small></h2>
          <table><thead><tr><th>Name</th><th>Category</th><th class="num">Amount</th>${k !== "allowance" ? `<th>Due day</th>` : `<th class="num">Per paycheck</th>`}${k === "annual" ? "<th>Months</th>" : ""}${k === "debt" ? `<th class="num">Remaining</th><th>As of</th>` : ""}<th>Active</th><th>Notes</th><th></th></tr></thead>
          <tbody>${list.map((b) => `<tr class="${b.active === false ? "done" : ""}">
            <td>${cell(b, "name", b.name, "wide")}</td><td>${cell(b, "category", b.category, "wide")}</td>
            <td class="num">${cell(b, "amount", Number(b.amount).toFixed(2))}</td>
            ${k !== "allowance" ? `<td>${cell(b, "due_day", b.due_day, "day")}</td>` : `<td class="num muted">${money(L.perPaycheck(b.amount))}</td>`}
            ${k === "annual" ? `<td>${cell(b, "months", (b.months || []).join(","), "day")}</td>` : ""}
            ${k === "debt" ? `<td class="num">${cell(b, "remaining", Number(b.remaining || 0).toFixed(2))}</td><td>${cell(b, "remaining_as_of", b.remaining_as_of, "", "date")}</td>` : ""}
            <td><input type="checkbox" data-change="bill-active" data-id="${b.id}" ${b.active !== false ? "checked" : ""} /></td>
            <td>${cell(b, "notes", b.notes, "wide")}</td>
            <td><button class="btn link small danger" data-act="del-bill" data-id="${b.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
      }).join("") + `
      <div class="card"><h2>Add a bill or income</h2>
        <form class="row" data-form="bill">
          <input type="text" name="name" placeholder="Name" required style="flex:1;min-width:160px" />
          <select name="kind">${groups.map((k) => `<option value="${k}" ${k === "monthly" ? "selected" : ""}>${KINDS[k]}</option>`).join("")}</select>
          <input type="text" name="category" placeholder="Category" required style="width:130px" />
          <input type="text" name="amount" placeholder="$0.00" inputmode="decimal" required style="width:110px" />
          <input type="number" name="due_day" placeholder="Due day" min="1" max="31" style="width:100px" />
          <input type="text" name="months" placeholder="Months (yearly)" style="width:140px" />
          <input type="text" name="remaining" placeholder="Remaining (debt)" style="width:140px" />
          <button class="btn primary" type="submit">Add</button></form></div>`;
  }

  function viewSettings() {
    const s = S.settings;
    return head("Settings") + `
      <div class="grid g2">
        <div class="card"><h2>Budget</h2>
          <form class="form-grid" data-form="settings">
            <label>Paycheck (take home)</label><input type="text" name="paycheck" value="${Number(s.paycheck).toFixed(2)}" />
            <label>A known payday</label><input type="date" name="first_payday" value="${esc(s.first_payday)}" />
            <label>Starting balance</label><input type="text" name="starting_balance" value="${Number(s.starting_balance).toFixed(2)}" />
            <label>Plan ahead (months)</label><input type="number" name="horizon_months" min="3" max="36" value="${esc(s.horizon_months)}" />
            <span></span><div class="small muted">Starting balance is your checking balance on the first payday above, before that check. It makes the running balance match your bank.</div>
            <span></span><div><button class="btn primary" type="submit">Save</button></div>
          </form></div>
        <div class="card"><h2>This computer</h2>
          <div class="form-grid">
            <label>Who uses it</label><select data-change="me">${PEOPLE.map((p) => `<option ${p === LS.me ? "selected" : ""}>${p}</option>`).join("")}</select>
            <label>Signed in as</label><div>${esc(S.session?.user?.email || "")}</div>
            <label>App version</label><div class="row"><span>${esc(S.version || "unknown")}</span><button class="btn small" data-act="check-update" ${S.updatePct !== null ? "disabled" : ""}>Check for updates</button></div>
            <label>Database</label><div class="small muted" style="word-break:break-all">${esc(LS.url)}</div>
            <span></span><div class="row"><button class="btn" data-act="sign-out">Sign out</button><button class="btn danger" data-act="change-connection">Change connection</button></div>
          </div></div>
      </div>`;
  }

  // ---------------------------------------------------------------- updates
  async function checkForUpdate(manual) {
    if (!window.updater) { if (manual) toast("Updates can only be checked in the installed app", true); return; }
    const r = await window.updater.check();
    S.update = r;
    if (manual) {
      if (r.error) toast("Couldn't check for updates: " + r.error, true);
      else if (!r.available) toast(`You're on the latest version (${r.current})`);
      S.updateDismissed = null;
    }
    if (S.settings) safeRender();
  }
  async function installUpdate() {
    const info = S.update && S.update.info;
    if (!info || S.updatePct !== null) return;
    S.updatePct = 0; S.updateErr = null; render();
    const off = window.updater.onProgress((pct) => {
      S.updatePct = pct;
      const el = document.getElementById("upd-pct"); if (el) el.textContent = pct + "%";
      const bar = document.getElementById("upd-bar"); if (bar) bar.style.width = pct + "%";
    });
    const r = await window.updater.install(info);
    off();
    if (r.ok) { S.updatePct = 100; S.updateDone = true; render(); }
    else { S.updatePct = null; S.updateErr = r.error; render(); }
  }
  function updateBanner() {
    const u = S.update;
    if (S.updateErr) return `<div class="banner"><span>The update didn't install: ${esc(S.updateErr)}</span><button class="btn small" data-act="install-update">Try again</button></div>`;
    if (!u || !u.available || S.updateDismissed === u.latest) return "";
    if (S.updateDone) return `<div class="banner update"><span>Update downloaded. The installer is opening and this window will close. Click through the installer, then open Household Budget again.</span></div>`;
    if (S.updatePct !== null) return `<div class="banner update"><span>Downloading version ${esc(u.latest)}... <b id="upd-pct">${S.updatePct}%</b></span><div class="bar" style="width:220px;margin:0"><span id="upd-bar" style="width:${S.updatePct}%"></span></div></div>`;
    return `<div class="banner update"><span>Version ${esc(u.latest)} is available${u.notes ? ": " + esc(u.notes) : "."}</span>
      <span class="row"><button class="btn small primary" data-act="install-update">Install update</button><button class="btn small link" data-act="dismiss-update">Later</button></span></div>`;
  }

  // ---------------------------------------------------------------- events
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act, id = Number(el.dataset.id);
    if (act === "nav") { S.view = el.dataset.view; render(); root.querySelector(".main").scrollTop = 0; }
    else if (act === "set-me") { LS.me = el.dataset.name; start(); }
    else if (act === "sign-out") { await S.sb.auth.signOut(); }
    else if (act === "change-connection") {
      if (!confirm("Disconnect this computer from the current Supabase project? Your data stays in Supabase.")) return;
      try { if (S.sb) await S.sb.auth.signOut(); } catch (_) {}
      localStorage.removeItem("hb.url"); localStorage.removeItem("hb.key"); localStorage.setItem("hb.custom", "1"); location.reload();
    }
    else if (act === "rebuild") { rebuildSchedule(); }
    else if (act === "check-update") { checkForUpdate(true); }
    else if (act === "install-update") { installUpdate(); }
    else if (act === "dismiss-update") { S.updateDismissed = S.update?.latest; render(); }
    else if (act === "toggle-period") { S.openPeriod = S.openPeriod === el.dataset.payday ? null : el.dataset.payday; render(); }
    else if (act === "month") {
      const k = el.dataset.key === "sched" ? "schedMonth" : "txMonth"; const step = Number(el.dataset.step);
      S[k] = step === 0 ? L.monthKey(L.todayIso()) : shiftMonth(S[k], step); render();
    }
    else if (act === "del-tx") {
      if (!confirm("Delete this spending entry?")) return;
      if (await run(S.sb.from("transactions").delete().eq("id", id), "Deleted")) { S.transactions = S.transactions.filter((t) => t.id !== id); render(); }
    }
    else if (act === "del-sched") {
      if (!confirm("Delete this one-time item?")) return;
      if (await run(S.sb.from("schedule").delete().eq("id", id), "Deleted")) { S.schedule = S.schedule.filter((r) => r.id !== id); render(); }
    }
    else if (act === "del-bill") {
      const b = S.bills.find((x) => x.id === id);
      if (!confirm(`Delete "${b?.name}"? Past schedule items stay. Future ones go away after you update the schedule.`)) return;
      if (await run(S.sb.from("bills").delete().eq("id", id), "Deleted")) { S.bills = S.bills.filter((x) => x.id !== id); S.billsDirty = true; render(); }
    }
  });

  root.addEventListener("change", async (e) => {
    const el = e.target.closest("[data-change]");
    if (!el) return;
    const kind = el.dataset.change, id = Number(el.dataset.id);
    if (kind === "paid") {
      const r = S.schedule.find((x) => x.id === id); if (!r) return;
      r.paid = el.checked; render();
      await run(S.sb.from("schedule").update({ paid: el.checked, updated_at: new Date().toISOString() }).eq("id", id));
    } else if (kind === "actual") {
      const v = el.value.trim() === "" ? null : fromAmount(el.value);
      if (el.value.trim() !== "" && v === null) { toast("That isn't an amount", true); return; }
      const r = S.schedule.find((x) => x.id === id); if (r) r.actual = v;
      if (await run(S.sb.from("schedule").update({ actual: v, updated_at: new Date().toISOString() }).eq("id", id), v === null ? "Back to planned amount" : "Saved")) safeRender();
    } else if (kind === "sched-filter") { S.schedFilter = el.value; render(); }
    else if (kind === "me") { LS.me = el.value; toast(`This computer is now ${el.value}'s`); renderFoot(); }
    else if (kind === "bill-active") {
      const b = S.bills.find((x) => x.id === id); if (b) b.active = el.checked;
      if (await run(S.sb.from("bills").update({ active: el.checked }).eq("id", id), "Saved")) { S.billsDirty = true; render(); }
    } else if (kind === "bill") {
      const field = el.dataset.field; let v = el.value.trim();
      if (field === "amount" || field === "remaining") { v = fromAmount(v); if (v === null) return toast("That isn't an amount", true); }
      else if (field === "due_day") { v = v === "" ? null : parseInt(v, 10); if (v !== null && (isNaN(v) || v < 1 || v > 31)) return toast("Due day should be 1 to 31", true); }
      else if (field === "months") { v = v.split(/[ ,]+/).filter(Boolean).map(Number); if (v.some((m) => !(m >= 1 && m <= 12))) return toast("Months should be numbers 1 to 12, like 1,7", true); }
      else if (field === "remaining_as_of") { v = v || null; }
      else if (field === "notes") { v = v || null; }
      else if (!v) return toast("This can't be blank", true);
      const b = S.bills.find((x) => x.id === id); if (b) b[field] = v;
      if (await run(S.sb.from("bills").update({ [field]: v }).eq("id", id), "Saved")) { S.billsDirty = true; safeRender(); }
    }
  });

  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const kind = form.dataset.form;
    if (kind === "setup") {
      const url = f.url.trim().replace(/\/+$/, "");
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return renderSetup("The Project URL should look like https://abcd1234.supabase.co");
      LS.url = url; LS.key = f.key.trim(); location.reload();
    } else if (kind === "login") {
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Signing in...";
      const { data, error } = await S.sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
      if (error) return renderLogin(error.message === "Invalid login credentials" ? "That email and password didn't match." : error.message);
      S.session = data.session; start();
    } else if (kind === "tx") {
      const amount = fromAmount(f.amount);
      if (amount === null || amount === 0) return toast("Enter an amount", true);
      const row = { date: f.date, who: f.who, category: f.category, amount, note: f.note.trim() || null };
      const data = await run(S.sb.from("transactions").insert(row).select().single(), `Logged ${money(amount)} ${f.category.toLowerCase()}`);
      if (data) { if (!S.transactions.some((t) => t.id === data.id)) S.transactions.push(data); render(); }
    } else if (kind === "manual") {
      const amount = fromAmount(f.amount);
      if (amount === null) return toast("Enter an amount", true);
      const row = { date: f.date, item: f.item.trim(), direction: f.direction, category: f.category.trim() || "Other", planned: amount, source: "manual" };
      const data = await run(S.sb.from("schedule").insert(row).select().single(), "Added to the schedule");
      if (data) { if (!S.schedule.some((r) => r.id === data.id)) S.schedule = L.sortRows([...S.schedule, data]); render(); }
    } else if (kind === "bill") {
      const amount = fromAmount(f.amount);
      if (amount === null) return toast("Enter an amount", true);
      const months = f.months.split(/[ ,]+/).filter(Boolean).map(Number);
      if (f.kind === "annual" && (!months.length || months.some((m) => !(m >= 1 && m <= 12)))) return toast("Yearly bills need months, like 1,7", true);
      if (f.kind !== "allowance" && !f.due_day) return toast("Add the day of the month it's due", true);
      const row = {
        name: f.name.trim(), kind: f.kind, category: f.category.trim(), amount,
        due_day: f.due_day ? Number(f.due_day) : null, months: f.kind === "annual" ? months : null,
        remaining: f.kind === "debt" ? fromAmount(f.remaining) : null, remaining_as_of: f.kind === "debt" ? L.todayIso() : null,
        sort: Math.max(0, ...S.bills.map((b) => b.sort || 0)) + 1,
      };
      const data = await run(S.sb.from("bills").insert(row).select().single(), "Added. Update the schedule to include it.");
      if (data) { if (!S.bills.some((b) => b.id === data.id)) S.bills.push(data); S.billsDirty = true; render(); }
    } else if (kind === "settings") {
      const upd = {
        paycheck: fromAmount(f.paycheck), starting_balance: fromAmount(f.starting_balance),
        first_payday: f.first_payday, horizon_months: parseInt(f.horizon_months, 10), updated_at: new Date().toISOString(),
      };
      if (upd.paycheck === null || upd.starting_balance === null || !upd.first_payday || !(upd.horizon_months >= 3)) return toast("Check the values", true);
      const scheduleChanged = upd.paycheck !== Number(S.settings.paycheck) || upd.first_payday !== S.settings.first_payday || upd.horizon_months !== Number(S.settings.horizon_months);
      if (await run(S.sb.from("settings").update(upd).eq("id", 1), "Settings saved")) {
        Object.assign(S.settings, upd); if (scheduleChanged) S.billsDirty = true; render();
      }
    }
  });

  boot();
})();
