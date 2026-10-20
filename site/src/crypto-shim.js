// Browser stand-in for the three Node 'crypto' calls Ledgerline's engine makes.
// Only used by the in-browser playground on the live site. The real server uses Node's crypto.
// scryptSync here is a fast non-cryptographic hash: fine for a demo bank that lives in one tab,
// never for real passwords.
function bytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function wrap(arr) {
  return {
    toString(encoding) {
      if (encoding !== 'hex') throw new Error(`crypto-shim: unsupported encoding ${encoding}`);
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    },
  };
}

function randomBytes(n) {
  return wrap(bytes(n));
}

function randomInt(min, max) {
  const [x] = new Uint32Array(bytes(4).buffer);
  return min + (x % (max - min));
}

function scryptSync(password, salt, length) {
  const out = new Uint8Array(length);
  let h = 2166136261;
  const text = `${salt}:${password}`;
  for (let round = 0; round < length; round++) {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i) + round;
      h = Math.imul(h, 16777619) >>> 0;
    }
    out[round] = h & 0xff;
  }
  return wrap(out);
}

module.exports = { randomBytes, randomInt, scryptSync };
