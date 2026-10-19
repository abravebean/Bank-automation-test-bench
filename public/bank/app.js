// Ledgerline demo bank: a small single-page app over /bank/api.
const $ = (id) => document.getElementById(id);
const views = ['view-login', 'view-app', 'view-accounts', 'view-transfer', 'view-history'];
let accounts = [];
let idempotencyKey = newKey();

function newKey() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^\w-]/g, '');
}

function show(...ids) {
  for (const v of views) $(v).hidden = !ids.includes(v);
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(`/bank/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function setAlert(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

// ---------------------------------------------------------------- sign in / out

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setAlert($('login-error'), '');
  const button = e.submitter || $('login-form').querySelector('button');
  button.disabled = true;
  const { ok, data } = await api('POST', '/login', { username: $('username').value, password: $('password').value });
  button.disabled = false;
  if (!ok) {
    setAlert($('login-error'), data?.error || 'Sign-in failed');
    $('password').value = '';
    return;
  }
  $('login-form').reset();
  location.hash = '#/accounts';
  route();
});

$('logout').addEventListener('click', async () => {
  await api('POST', '/logout');
  location.hash = '';
  show('view-login');
  $('username').focus();
});

// ---------------------------------------------------------------- accounts

async function loadAccounts() {
  const { ok, status, data } = await api('GET', '/accounts');
  if (!ok) {
    if (status === 401) return showLogin();
    return;
  }
  accounts = data.accounts;
  const list = $('accounts');
  list.innerHTML = '';
  for (const a of accounts) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#/accounts/${a.id}`;
    link.className = 'account';
    link.dataset.testid = `account-${a.type}`;
    link.innerHTML = `<span class="acct-name"></span><span class="acct-number"></span><span class="acct-balance"></span>`;
    link.querySelector('.acct-name').textContent = a.name;
    link.querySelector('.acct-number').textContent = a.number;
    link.querySelector('.acct-balance').textContent = a.balance;
    link.setAttribute('aria-label', `${a.name} ${a.number}, balance ${a.balance}`);
    li.appendChild(link);
    list.appendChild(li);
  }
  $('limit').textContent = `Transferred today: ${data.transferredToday} of your ${data.dailyLimit} daily limit.`;
}

// ---------------------------------------------------------------- transfer

function fillAccountSelects() {
  for (const [id, pick] of [['from', 0], ['to', 1]]) {
    const select = $(id);
    select.innerHTML = '';
    for (const a of accounts) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.name} ${a.number} (${a.balance})`;
      select.appendChild(opt);
    }
    if (accounts[pick]) select.value = accounts[pick].id;
  }
}

$('transfer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setAlert($('transfer-error'), '');
  $('amount').removeAttribute('aria-invalid');
  const submit = $('transfer-submit');
  submit.disabled = true; // no double submits from the UI; the API also enforces Idempotency-Key
  const body = {
    fromAccountId: $('from').value,
    toAccountId: $('to').value,
    amount: $('amount').value,
    memo: $('memo').value,
  };
  const { ok, status, data } = await api('POST', '/transfers', body, { 'Idempotency-Key': idempotencyKey });
  submit.disabled = false;
  if (status === 401) return showLogin();
  if (!ok) {
    setAlert($('transfer-error'), data?.error || 'Transfer failed');
    if (data?.field === 'amount') $('amount').setAttribute('aria-invalid', 'true');
    return;
  }
  idempotencyKey = newKey();
  const t = data.transfer;
  const from = accounts.find((a) => a.id === t.fromAccountId);
  const to = accounts.find((a) => a.id === t.toAccountId);
  const receipt = $('transfer-success');
  receipt.innerHTML = `
    <h2>Transfer complete</h2>
    <dl>
      <div><dt>Amount</dt><dd data-testid="receipt-amount"></dd></div>
      <div><dt>From</dt><dd></dd></div>
      <div><dt>To</dt><dd></dd></div>
      <div><dt>Reference</dt><dd data-testid="receipt-reference"></dd></div>
    </dl>
    <a class="btn-primary" href="#/accounts">Back to accounts</a>`;
  const dds = receipt.querySelectorAll('dd');
  dds[0].textContent = t.amount;
  dds[1].textContent = `${from.name} (new balance ${data.balances[from.id].balance})`;
  dds[2].textContent = `${to.name} (new balance ${data.balances[to.id].balance})`;
  dds[3].textContent = t.reference;
  $('transfer-form').hidden = true;
  receipt.hidden = false;
  receipt.querySelector('h2').setAttribute('tabindex', '-1');
  receipt.querySelector('h2').focus();
});

// ---------------------------------------------------------------- history

async function loadHistory(id) {
  const { ok, status, data } = await api('GET', `/accounts/${encodeURIComponent(id)}/transactions`);
  if (status === 401) return showLogin();
  if (!ok) {
    $('history-title').textContent = 'Account not found';
    $('history-balance').textContent = '';
    $('history-rows').innerHTML = '';
    return;
  }
  $('history-title').textContent = `${data.account.name} ${data.account.number}`;
  $('history-balance').textContent = `Available balance ${data.account.balance}`;
  const rows = $('history-rows');
  rows.innerHTML = '';
  for (const t of data.transactions) {
    const tr = document.createElement('tr');
    const cells = [new Date(t.date).toLocaleString(), t.description, t.amount, t.balanceAfter];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i >= 2) td.className = 'num';
      if (i === 2) td.classList.add(t.amountCents < 0 ? 'debit' : 'credit');
      tr.appendChild(td);
    });
    rows.appendChild(tr);
  }
}

// ---------------------------------------------------------------- routing

function showLogin() {
  show('view-login');
}

async function route() {
  const me = await api('GET', '/me');
  if (!me.ok) return showLogin();
  $('who').textContent = me.data.name;
  const hash = location.hash || '#/accounts';
  let m;
  if ((m = hash.match(/^#\/accounts\/([\w-]+)$/))) {
    show('view-app', 'view-history');
    await loadHistory(m[1]);
  } else if (hash === '#/transfer') {
    await loadAccounts();
    fillAccountSelects();
    $('transfer-form').reset();
    fillAccountSelects();
    $('transfer-form').hidden = false;
    $('transfer-success').hidden = true;
    setAlert($('transfer-error'), '');
    show('view-app', 'view-transfer');
  } else {
    $('welcome').textContent = `Welcome back, ${me.data.name.split(' ')[0]}`;
    show('view-app', 'view-accounts');
    await loadAccounts();
  }
}

window.addEventListener('hashchange', route);
route();
