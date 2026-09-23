const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Writable } = require('node:stream');
const { readHidden } = require('../scripts/bootstrap-admin');
const { verifyPassword } = require('../src/routes');

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
