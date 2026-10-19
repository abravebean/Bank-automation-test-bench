// Ledgerline: a fictional demo bank used as the system under test.
//
// Business rules live here, separate from HTTP, so they can be unit-tested directly.
// All money is stored as integer cents. Floating point is never used for amounts
// (0.1 + 0.2 !== 0.3 in JavaScript), which is also how real ledgers avoid rounding drift.
const crypto = require('crypto');

const RULES = Object.freeze({
  maxFailedLogins: 3,
  lockMinutes: 15,
  dailyTransferLimitCents: 250_000, // $2,500.00 per customer per day
  maxAmountCents: 100_000_000, // $1,000,000.00: anything larger is rejected as invalid input
});

class BankError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** "12.34" -> 1234. Accepts up to two decimal places; rejects anything else. */
function parseAmountToCents(input) {
  const text = String(input ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new BankError(400, 'Enter an amount like 25 or 25.50 (up to two decimal places)', 'amount');
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0) throw new BankError(400, 'Amount must be more than $0.00', 'amount');
  if (cents > RULES.maxAmountCents) throw new BankError(400, 'Amount is too large', 'amount');
  return cents;
}

function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

class Bank {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.customers = new Map(); // username -> customer
    this.accounts = new Map(); // id -> account
    this.transactions = []; // ledger entries
    this.transfers = new Map(); // id -> transfer
    this.idempotency = new Map(); // `${username}:${key}` -> { fingerprint, result }
    this.loginAttempts = new Map(); // username -> { failures, lockedUntil }
    this.sessions = new Map(); // token -> username
    this.seq = 1000;

    this.createCustomer({ username: 'demo_user', password: 'demo_pass', name: 'Alex Rivera', checkingCents: 325_000, savingsCents: 1_240_000 });
    this.createCustomer({ username: 'jordan', password: 'jordan_pass', name: 'Jordan Lee', checkingCents: 98_000, savingsCents: 410_000 });
  }

  nextId(prefix) {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  createCustomer({ username, password, name, checkingCents = 100_000, savingsCents = 500_000 }) {
    if (this.customers.has(username)) throw new BankError(409, 'Username already exists');
    const salt = crypto.randomBytes(8).toString('hex');
    const customer = { username, name, salt, passwordHash: hashPassword(password, salt), accountIds: [] };
    for (const [type, cents] of [['checking', checkingCents], ['savings', savingsCents]]) {
      const id = this.nextId('acc_');
      const number = String(crypto.randomInt(1000, 9999));
      this.accounts.set(id, { id, owner: username, type, name: type === 'checking' ? 'Everyday Checking' : 'High-Yield Savings', number, balanceCents: cents });
      customer.accountIds.push(id);
      this.post(id, cents, 'Opening deposit');
    }
    this.customers.set(username, customer);
    return customer;
  }

  /** Appends a ledger entry and returns it. */
  post(accountId, amountCents, description, transferId = null) {
    const account = this.accounts.get(accountId);
    const entry = {
      id: this.nextId('txn_'),
      accountId,
      amountCents,
      balanceAfterCents: account.balanceCents,
      description,
      transferId,
      createdAt: this.now().toISOString(),
    };
    this.transactions.push(entry);
    return entry;
  }

  // ---------------------------------------------------------------- authentication

  /**
   * Same message for an unknown username and a wrong password, so the login form can't be
   * used to discover which usernames exist. Lockout counts attempts per username string,
   * known or not, for the same reason.
   */
  login(username, password) {
    const key = String(username ?? '');
    const state = this.loginAttempts.get(key) ?? { failures: 0, lockedUntil: 0 };
    if (state.lockedUntil > this.now().getTime()) {
      throw new BankError(423, `Too many failed attempts. Try again in ${RULES.lockMinutes} minutes.`);
    }
    const customer = this.customers.get(key);
    const ok = customer && hashPassword(String(password ?? ''), customer.salt) === customer.passwordHash;
    if (!ok) {
      state.failures += 1;
      if (state.failures >= RULES.maxFailedLogins) {
        state.lockedUntil = this.now().getTime() + RULES.lockMinutes * 60_000;
        state.failures = 0;
        this.loginAttempts.set(key, state);
        throw new BankError(423, `Too many failed attempts. Try again in ${RULES.lockMinutes} minutes.`);
      }
      this.loginAttempts.set(key, state);
      throw new BankError(401, 'Invalid username or password');
    }
    this.loginAttempts.delete(key);
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, key);
    return { token, customer };
  }

  logout(token) {
    this.sessions.delete(token);
  }

  customerForSession(token) {
    const username = token && this.sessions.get(token);
    return username ? this.customers.get(username) : null;
  }

  // ---------------------------------------------------------------- accounts

  accountsFor(customer) {
    return customer.accountIds.map((id) => this.accounts.get(id));
  }

  /** 404, not 403, for someone else's account: don't confirm that it exists. */
  ownedAccount(customer, accountId) {
    const account = this.accounts.get(accountId);
    if (!account || account.owner !== customer.username) throw new BankError(404, 'Account not found');
    return account;
  }

  history(customer, accountId) {
    this.ownedAccount(customer, accountId);
    return this.transactions.filter((t) => t.accountId === accountId).reverse();
  }

  transferredToday(customer) {
    const today = utcDay(this.now());
    let total = 0;
    for (const t of this.transfers.values()) {
      if (t.owner === customer.username && utcDay(new Date(t.createdAt)) === today) total += t.amountCents;
    }
    return total;
  }

  // ---------------------------------------------------------------- transfers

  /**
   * Moves money between two of the customer's own accounts.
   * Validation order: input format -> ownership -> same account -> funds -> daily limit.
   * The debit and credit happen together (no await in between), so concurrent requests
   * can't both spend the same balance.
   */
  transfer(customer, { fromAccountId, toAccountId, amount, memo }, idempotencyKey) {
    const fingerprint = JSON.stringify([fromAccountId, toAccountId, String(amount), memo ?? '']);
    const idemKey = idempotencyKey ? `${customer.username}:${idempotencyKey}` : null;
    if (idemKey && this.idempotency.has(idemKey)) {
      const saved = this.idempotency.get(idemKey);
      if (saved.fingerprint !== fingerprint) {
        throw new BankError(409, 'This Idempotency-Key was already used for a different transfer');
      }
      return { ...saved.result, replayed: true };
    }

    const amountCents = parseAmountToCents(amount);
    const from = this.ownedAccount(customer, fromAccountId);
    const to = this.ownedAccount(customer, toAccountId);
    if (from.id === to.id) throw new BankError(400, 'Choose two different accounts', 'toAccountId');
    if (amountCents > from.balanceCents) {
      throw new BankError(422, `Insufficient funds: ${from.name} has ${formatCents(from.balanceCents)} available`, 'amount');
    }
    const usedToday = this.transferredToday(customer);
    if (usedToday + amountCents > RULES.dailyTransferLimitCents) {
      const left = RULES.dailyTransferLimitCents - usedToday;
      throw new BankError(422, `Daily transfer limit is ${formatCents(RULES.dailyTransferLimitCents)}. You can transfer ${formatCents(left)} more today.`, 'amount');
    }

    const id = this.nextId('trf_');
    const note = String(memo ?? '').slice(0, 80);
    from.balanceCents -= amountCents;
    to.balanceCents += amountCents;
    const transfer = {
      id,
      reference: `LL-${id.slice(4)}`,
      owner: customer.username,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents,
      memo: note,
      createdAt: this.now().toISOString(),
    };
    this.transfers.set(id, transfer);
    this.post(from.id, -amountCents, `Transfer to ${to.name}${note ? `: ${note}` : ''}`, id);
    this.post(to.id, amountCents, `Transfer from ${from.name}${note ? `: ${note}` : ''}`, id);

    const result = { transfer, balances: { [from.id]: from.balanceCents, [to.id]: to.balanceCents } };
    if (idemKey) this.idempotency.set(idemKey, { fingerprint, result });
    return { ...result, replayed: false };
  }

  /** Sum of every balance. Internal transfers must never change it. */
  totalHoldingsCents() {
    let total = 0;
    for (const a of this.accounts.values()) total += a.balanceCents;
    return total;
  }

  /** Each account's balance must equal the sum of its ledger entries. */
  ledgerMismatches() {
    const sums = new Map();
    for (const t of this.transactions) sums.set(t.accountId, (sums.get(t.accountId) ?? 0) + t.amountCents);
    return [...this.accounts.values()]
      .filter((a) => (sums.get(a.id) ?? 0) !== a.balanceCents)
      .map((a) => a.id);
  }
}

module.exports = { Bank, BankError, RULES, parseAmountToCents, formatCents };
