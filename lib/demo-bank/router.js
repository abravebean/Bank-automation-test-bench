// HTTP API for the Ledgerline demo bank, mounted at /bank.
//
//   POST /bank/api/login                       { username, password } -> session cookie
//   POST /bank/api/logout
//   GET  /bank/api/me
//   GET  /bank/api/accounts
//   GET  /bank/api/accounts/:id/transactions
//   POST /bank/api/transfers                   { fromAccountId, toAccountId, amount, memo }
//                                              optional Idempotency-Key header
//
// Test hooks (only when DEMO_BANK_TEST_HOOKS=true, never on a shared deployment):
//   POST /bank/api/test/customers   create an isolated customer for one test
//   GET  /bank/api/test/integrity   ledger invariants for data-integrity tests
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Bank, BankError, RULES, formatCents } = require('./bank');

const COOKIE = 'll_session';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function accountView(a) {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    number: `••••${a.number}`,
    balanceCents: a.balanceCents,
    balance: formatCents(a.balanceCents),
  };
}

function createBankRouter({ bank = new Bank(), testHooks = process.env.DEMO_BANK_TEST_HOOKS === 'true' } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  // Static UI (single page) at /bank/
  router.use(express.static(path.join(__dirname, '..', '..', 'public', 'bank')));

  const send = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof BankError) {
        res.status(err.status).json({ error: err.message, ...(err.field ? { field: err.field } : {}) });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
      }
    }
  };

  const auth = (req, res, next) => {
    const customer = bank.customerForSession(readCookie(req, COOKIE));
    if (!customer) return res.status(401).json({ error: 'Please sign in' });
    req.customer = customer;
    next();
  };

  router.post('/api/login', send((req, res) => {
    const { token, customer } = bank.login(req.body?.username, req.body?.password);
    // HttpOnly: page scripts can't read it. SameSite=Strict: other sites can't send it (CSRF).
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/bank', secure: req.secure });
    res.json({ name: customer.name, username: customer.username });
  }));

  router.post('/api/logout', (req, res) => {
    bank.logout(readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/bank' });
    res.status(204).end();
  });

  router.get('/api/me', auth, (req, res) => {
    res.json({ name: req.customer.name, username: req.customer.username });
  });

  router.get('/api/accounts', auth, (req, res) => {
    res.json({
      accounts: bank.accountsFor(req.customer).map(accountView),
      dailyLimit: formatCents(RULES.dailyTransferLimitCents),
      transferredToday: formatCents(bank.transferredToday(req.customer)),
    });
  });

  router.get('/api/accounts/:id/transactions', auth, send((req, res) => {
    const account = bank.ownedAccount(req.customer, req.params.id);
    res.json({
      account: accountView(account),
      transactions: bank.history(req.customer, req.params.id).map((t) => ({
        id: t.id,
        date: t.createdAt,
        description: t.description,
        amountCents: t.amountCents,
        amount: formatCents(t.amountCents),
        balanceAfterCents: t.balanceAfterCents,
        balanceAfter: formatCents(t.balanceAfterCents),
      })),
    });
  }));

  router.post('/api/transfers', auth, send((req, res) => {
    const key = req.get('Idempotency-Key');
    if (key !== undefined && !/^[\w-]{8,64}$/.test(key)) {
      throw new BankError(400, 'Idempotency-Key must be 8-64 letters, numbers, dashes or underscores');
    }
    const result = bank.transfer(req.customer, req.body ?? {}, key);
    if (result.replayed) res.set('Idempotent-Replay', 'true');
    res.status(result.replayed ? 200 : 201).json({
      transfer: { ...result.transfer, amount: formatCents(result.transfer.amountCents) },
      balances: Object.fromEntries(Object.entries(result.balances).map(([id, c]) => [id, { balanceCents: c, balance: formatCents(c) }])),
    });
  }));

  if (testHooks) {
    router.post('/api/test/customers', send((req, res) => {
      const username = `t_${crypto.randomBytes(5).toString('hex')}`;
      const password = crypto.randomBytes(9).toString('base64url');
      const customer = bank.createCustomer({
        username,
        password,
        name: req.body?.name || 'Test Customer',
        checkingCents: req.body?.checkingCents ?? 100_000,
        savingsCents: req.body?.savingsCents ?? 500_000,
      });
      res.status(201).json({ username, password, name: customer.name, accounts: bank.accountsFor(customer).map(accountView) });
    }));

    router.get('/api/test/integrity', (req, res) => {
      res.json({ totalHoldingsCents: bank.totalHoldingsCents(), ledgerMismatches: bank.ledgerMismatches() });
    });
  }

  router.use('/api', (req, res) => res.status(404).json({ error: `No bank API route for ${req.method} ${req.path}` }));
  return router;
}

module.exports = { createBankRouter };
