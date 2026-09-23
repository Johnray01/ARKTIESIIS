const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Writable } = require('node:stream');
const { readHidden } = require('../scripts/bootstrap-admin');
const { verifyPassword } = require('../src/routes');
const { isDevelopmentPasswordLoginEnabled } = require('../src/middleware/auth');
const twoFactor = require('../src/services/twoFactorService');

test('password-only authentication requires both development gate settings', () => {
  assert.equal(isDevelopmentPasswordLoginEnabled({ nodeEnv: 'development', devPasswordOnlyLogin: true }), true);
  assert.equal(isDevelopmentPasswordLoginEnabled({ nodeEnv: 'development', devPasswordOnlyLogin: false }), false);
  assert.equal(isDevelopmentPasswordLoginEnabled({ nodeEnv: 'production', devPasswordOnlyLogin: true }), false);
  assert.equal(isDevelopmentPasswordLoginEnabled({ nodeEnv: 'test', devPasswordOnlyLogin: true }), false);
});

test('missing and inactive accounts each perform one dummy bcrypt comparison', async () => {
  const comparedHashes = [];
  const comparePassword = async (password, hash) => {
    assert.equal(password, 'entered-password');
    comparedHashes.push(hash);
    return true;
  };

  assert.equal(await verifyPassword(null, 'entered-password', comparePassword), false);
  assert.equal(await verifyPassword({ is_active: false, password_hash: 'inactive-account-hash' }, 'entered-password', comparePassword), false);
  assert.equal(await verifyPassword({ is_active: true, password_hash: 'active-account-hash' }, 'entered-password', comparePassword), true);
  assert.equal(comparedHashes.length, 3);
  assert.equal(comparedHashes[0], comparedHashes[1]);
  assert.match(comparedHashes[0], /^\$2b\$12\$/);
  assert.equal(comparedHashes[2], 'active-account-hash');
});

test('OTP values are six-digit cryptographic values and use a cost-12 bcrypt hash', async () => {
  const code = twoFactor.generateOtp();
  assert.match(code, /^\d{6}$/);

  const hash = await twoFactor.hashOtp('001234');
  assert.match(hash, /^\$2b\$12\$/);
  assert.notEqual(hash, '001234');
  assert.equal(await twoFactor.compareOtp('001234', hash), true);
  assert.equal(await twoFactor.compareOtp('001235', hash), false);
});

test('OTP issuance stores only the code hash and enforces database-backed send limits', async () => {
  let statement;
  const values = {};
  const sql = { Int: 'Int', NVarChar: (length) => `NVarChar(${length})` };
  const result = await twoFactor.issueOtpChallenge({
    getPool: async () => ({
      request: () => ({
        input(name, type, value) { values[name] = value; return this; },
        async query(queryText) {
          statement = queryText;
          return { recordset: [{ allowed: 0, codeId: null }] };
        }
      })
    }),
    sql,
    userId: 42,
    createCode: () => '004219',
    hash: async (code) => `hash:${code}`
  });

  assert.deepEqual(result, { allowed: false, codeId: null, code: '004219' });
  assert.equal(values.userId, 42);
  assert.equal(values.codeHash, 'hash:004219');
  assert.equal(Object.hasOwn(values, 'code'), false);
  assert.match(statement, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(statement, /@maxSends/);
  assert.match(statement, /@cooldownSeconds/);
  assert.match(statement, /DATEADD\(MINUTE, -@sendWindowMinutes/);
  assert.match(statement, /SET consumed_at = @now/);
});

test('hidden bootstrap password input pauses stdin and restores terminal mode', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.rawModeChanges = [];
  input.setRawMode = (enabled) => {
    input.isRaw = enabled;
    input.rawModeChanges.push(enabled);
  };
  let outputText = '';
  const output = new Writable({
    write(chunk, encoding, callback) {
      outputText += chunk.toString();
      callback();
    }
  });
  output.isTTY = true;

  const pendingPassword = readHidden('Password: ', { input, output });
  input.write('invalid-password\r');
  assert.equal(await pendingPassword, 'invalid-password');

  assert.equal(input.isRaw, false);
  assert.equal(input.isPaused(), true);
  assert.deepEqual(input.rawModeChanges, [true, false]);
  assert.equal(outputText, 'Password: \n');
  input.destroy();
});
