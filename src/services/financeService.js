const { getPool: defaultGetPool, sql: defaultSql } = require('../config/database');

const ID_PATTERN = /^\d{1,10}$/;
const MAX_MONEY_CENTS = 999999999999n;

class FinanceServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'FinanceServiceError';
    this.status = status;
  }
}

function normalizeId(value) {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function recordInput(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new FinanceServiceError(`${label} must be ${maxLength} printable characters or fewer.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new FinanceServiceError(`${label} must be ${maxLength} printable characters or fewer.`);
  }
  return text;
}

function normalizeSearchTerm(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new FinanceServiceError('Search must be 100 printable characters or fewer.');
  const searchTerm = value.trim();
  if (searchTerm.length > 100 || /[\u0000-\u001f\u007f]/.test(searchTerm)) {
    throw new FinanceServiceError('Search must be 100 printable characters or fewer.');
  }
  return searchTerm;
}

function escapeLikePattern(value) {
  return value.replace(/[~%_[\]]/g, (character) => `~${character}`);
}

function parseMoneyCents(value, { allowNegative = false, allowZero = false } = {}) {
  const raw = typeof value === 'number' ? String(value) : value;
  const pattern = allowNegative ? /^-?\d{1,10}(?:\.\d{1,2})?$/ : /^\d{1,10}(?:\.\d{1,2})?$/;
  if (typeof raw !== 'string' || !pattern.test(raw)) {
    throw new FinanceServiceError('Amount must be a valid decimal with up to 10 whole digits and 2 decimal places.');
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents > MAX_MONEY_CENTS) throw new FinanceServiceError('Amount exceeds the supported financial limit.');
  const signedCents = negative ? -cents : cents;
  if (!allowZero && signedCents === 0n) throw new FinanceServiceError('Amount must not be zero.');
  return signedCents;
}

function formatMoneyCents(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function validateTransaction(input = {}) {
  input = recordInput(input);
  const transactionType = input.transactionType;
  if (!['charge', 'payment', 'adjustment'].includes(transactionType)) {
    throw new FinanceServiceError('Choose a charge, payment, or adjustment.');
  }
  const amountCents = parseMoneyCents(input.amount, { allowNegative: transactionType === 'adjustment' });
  const description = optionalText(input.description, 'Description', 500);
  if (transactionType === 'adjustment' && !description) {
    throw new FinanceServiceError('Enter a reason for the balance adjustment.');
  }
  const referenceNo = optionalText(input.referenceNo, 'Reference number', 100);
  return {
    transactionType,
    amountCents,
    amount: formatMoneyCents(amountCents),
    description,
    referenceNo
  };
}

function isUniqueConflict(error) {
  return error?.number === 2601 || error?.number === 2627;
}

function createFinanceService({
  getPool = defaultGetPool,
  sql = defaultSql,
  transactionFactory = (pool) => new sql.Transaction(pool)
} = {}) {
  async function runTransaction(callback) {
    const pool = await getPool();
    const transaction = transactionFactory(pool);
    let started = false;
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      started = true;
      const result = await callback(transaction);
      await transaction.commit();
      started = false;
      return result;
    } catch (error) {
      if (started) {
        try {
          await transaction.rollback();
        } catch {
          // Preserve the original failure without exposing database details to the caller.
        }
      }
      throw error;
    }
  }

  async function requireFinanceActor(transaction, actorInput) {
    const actorId = normalizeId(actorInput);
    if (!actorId) throw new FinanceServiceError('Finance or database administrator access is required.', 403);
    const result = await transaction.request()
      .input('actorId', sql.Int, actorId)
      .input('financeRole', sql.NVarChar(30), 'finance')
      .input('adminRole', sql.NVarChar(30), 'database_admin')
      .query(`SELECT id, role FROM dbo.users WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @actorId AND is_active = 1 AND role IN (@financeRole, @adminRole)`);
    const actor = result.recordset?.[0];
    if (!actor || !['finance', 'database_admin'].includes(actor.role)) {
      throw new FinanceServiceError('Your finance access is no longer active. Sign in again.', 403);
    }
    return actor;
  }

  async function writeAudit(transaction, { actorId, actorRole, action, entityId, details }) {
    await transaction.request()
      .input('actorId', sql.Int, actorId)
      .input('action', sql.NVarChar(100), actorRole === 'database_admin'
        ? `database_admin.finance_${action}`
        : `finance.${action}`)
      .input('entityType', sql.NVarChar(100), 'financial_account')
      .input('entityId', sql.NVarChar(100), String(entityId))
      .input('detailsJson', sql.NVarChar(sql.MAX), JSON.stringify(details))
      .query(`INSERT INTO dbo.audit_logs (user_id, action, entity_type, entity_id, details_json)
        VALUES (@actorId, @action, @entityType, @entityId, @detailsJson)`);
  }

  async function searchStudents(searchInput = '') {
    const searchTerm = normalizeSearchTerm(searchInput);
    if (!searchTerm) return { students: [], searchTerm };
    const searchPattern = `%${escapeLikePattern(searchTerm)}%`;
    const pool = await getPool();
    const result = await pool.request()
      .input('searchPattern', sql.NVarChar(204), searchPattern)
      .query(`SELECT TOP (100) s.id AS student_id, s.student_no, s.first_name, s.middle_name,
          s.last_name, s.suffix, a.id AS financial_account_id,
          CONVERT(NVARCHAR(40), a.balance) AS balance
        FROM dbo.students AS s
        LEFT JOIN dbo.financial_accounts AS a ON a.student_id = s.id
        WHERE s.student_no LIKE @searchPattern ESCAPE N'~'
          OR s.first_name LIKE @searchPattern ESCAPE N'~'
          OR s.middle_name LIKE @searchPattern ESCAPE N'~'
          OR s.last_name LIKE @searchPattern ESCAPE N'~'
          OR CONCAT_WS(N' ', s.first_name, NULLIF(s.middle_name, N''), s.last_name, NULLIF(s.suffix, N'')) LIKE @searchPattern ESCAPE N'~'
        ORDER BY s.last_name, s.first_name, s.student_no, s.id`);
    return { students: result.recordset || [], searchTerm };
  }

  async function listRecentAccounts(actorInput) {
    const actorId = normalizeId(actorInput);
    if (!actorId) throw new FinanceServiceError('Finance or database administrator access is required.', 403);
    const pool = await getPool();
    const result = await pool.request()
      .input('actorId', sql.Int, actorId)
      .query(`SELECT CONVERT(INT, CASE WHEN EXISTS (
          SELECT 1 FROM dbo.users
          WHERE id = @actorId AND is_active = 1 AND role IN ('finance', 'database_admin')
        ) THEN 1 ELSE 0 END) AS authorized;
        SELECT TOP (8) s.id AS student_id, s.student_no, s.first_name, s.middle_name,
          s.last_name, s.suffix, s.status, a.id AS financial_account_id,
          CONVERT(NVARCHAR(40), a.balance) AS balance, a.updated_at
        FROM dbo.financial_accounts AS a
        INNER JOIN dbo.students AS s ON s.id = a.student_id
        WHERE EXISTS (SELECT 1 FROM dbo.users
          WHERE id = @actorId AND is_active = 1 AND role IN ('finance', 'database_admin'))
        ORDER BY a.updated_at DESC, a.id DESC`);
    if (Number(result.recordsets?.[0]?.[0]?.authorized) !== 1) {
      throw new FinanceServiceError('Your finance access is no longer active. Sign in again.', 403);
    }
    return result.recordsets?.[1] || [];
  }

  async function getStudentAccount(studentInput) {
    const studentId = normalizeId(studentInput);
    if (!studentId) throw new FinanceServiceError('Student record not found.', 404);
    const pool = await getPool();
    const studentResult = await pool.request()
      .input('studentId', sql.Int, studentId)
      .query(`SELECT id AS student_id, student_no, first_name, middle_name, last_name, suffix, status
        FROM dbo.students WHERE id = @studentId`);
    const student = studentResult.recordset?.[0];
    if (!student) return null;

    const accountResult = await pool.request()
      .input('studentId', sql.Int, studentId)
      .query(`SELECT id AS financial_account_id, CONVERT(NVARCHAR(40), balance) AS balance
        FROM dbo.financial_accounts WHERE student_id = @studentId`);
    const account = accountResult.recordset?.[0] || null;
    if (!account) return { student, account: null, transactions: [] };

    const transactionResult = await pool.request()
      .input('accountId', sql.Int, account.financial_account_id)
      .query(`SELECT TOP (100) t.id, t.transaction_type,
          CONVERT(NVARCHAR(40), t.amount) AS amount, t.description, t.reference_no,
          t.recorded_by, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(sp.first_name, N' ', sp.last_name))), N''), CONCAT(N'Staff ', t.recorded_by)) AS recorded_by_name,
          t.created_at
        FROM dbo.financial_transactions AS t
        LEFT JOIN dbo.staff_profiles AS sp ON sp.user_id = t.recorded_by
        WHERE t.financial_account_id = @accountId
        ORDER BY t.created_at DESC, t.id DESC`);
    return { student, account, transactions: transactionResult.recordset || [] };
  }

  async function getDashboardSummary(actorInput) {
    const actorId = normalizeId(actorInput);
    if (!actorId) throw new FinanceServiceError('Finance or database administrator access is required.', 403);
    const pool = await getPool();
    const result = await pool.request()
      .input('actorId', sql.Int, actorId)
      .query(`SELECT
          (SELECT COUNT_BIG(*) FROM dbo.financial_accounts) AS account_count,
          (SELECT COUNT_BIG(*) FROM dbo.financial_accounts WHERE balance > 0) AS accounts_due_count,
          (SELECT COUNT_BIG(*) FROM dbo.financial_accounts WHERE balance = 0) AS accounts_settled_count,
          (SELECT COUNT_BIG(*) FROM dbo.financial_accounts WHERE balance < 0) AS accounts_credit_count,
          (SELECT COUNT_BIG(*) FROM dbo.financial_transactions WHERE transaction_type = 'charge') AS charge_count,
          (SELECT COUNT_BIG(*) FROM dbo.financial_transactions WHERE transaction_type = 'payment') AS payment_count
        WHERE EXISTS (SELECT 1 FROM dbo.users
          WHERE id = @actorId AND is_active = 1 AND role IN ('finance', 'database_admin'))`);
    const summary = result.recordset?.[0];
    if (!summary) throw new FinanceServiceError('Your finance access is no longer active. Sign in again.', 403);
    return summary;
  }

  async function createAccount(actorInput, studentInput) {
    const studentId = normalizeId(studentInput);
    if (!studentId) throw new FinanceServiceError('Choose a valid student record.');
    return runTransaction(async (transaction) => {
      const actor = await requireFinanceActor(transaction, actorInput);
      const studentResult = await transaction.request()
        .input('studentId', sql.Int, studentId)
        .query('SELECT id, status FROM dbo.students WITH (UPDLOCK, HOLDLOCK) WHERE id = @studentId');
      const student = studentResult.recordset?.[0];
      if (!student) throw new FinanceServiceError('Student record not found.', 404);
      if (student.status === 'archived') throw new FinanceServiceError('Archived students cannot receive new finance records.', 409);

      const existingResult = await transaction.request()
        .input('studentId', sql.Int, studentId)
        .query('SELECT id FROM dbo.financial_accounts WITH (UPDLOCK, HOLDLOCK) WHERE student_id = @studentId');
      if (existingResult.recordset?.length) throw new FinanceServiceError('This student already has a financial account.', 409);

      const insertResult = await transaction.request()
        .input('studentId', sql.Int, studentId)
        .query(`INSERT INTO dbo.financial_accounts (student_id, balance)
          OUTPUT INSERTED.id AS id VALUES (@studentId, 0)`);
      const accountId = insertResult.recordset?.[0]?.id;
      if (!Number.isSafeInteger(accountId) || accountId < 1) throw new Error('Financial account insert returned no identifier.');
      await writeAudit(transaction, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'account_created',
        entityId: accountId,
        details: { studentId }
      });
      return accountId;
    });
  }

  async function recordTransaction(actorInput, studentInput, input = {}) {
    const studentId = normalizeId(studentInput);
    if (!studentId) throw new FinanceServiceError('Choose a valid student record.');
    const entry = validateTransaction(input);
    return runTransaction(async (transaction) => {
      const actor = await requireFinanceActor(transaction, actorInput);
      const accountResult = await transaction.request()
        .input('studentId', sql.Int, studentId)
        .query(`SELECT a.id AS financial_account_id, CONVERT(NVARCHAR(40), a.balance) AS balance, s.status
          FROM dbo.financial_accounts AS a WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.students AS s WITH (UPDLOCK, HOLDLOCK) ON s.id = a.student_id
          WHERE s.id = @studentId`);
      const account = accountResult.recordset?.[0];
      if (!account) throw new FinanceServiceError('Financial account not found. Create the account before recording a transaction.', 404);
      if (account.status === 'archived') throw new FinanceServiceError('Archived students cannot receive new finance records.', 409);

      if (entry.referenceNo) {
        const duplicate = await transaction.request()
          .input('accountId', sql.Int, account.financial_account_id)
          .input('referenceNo', sql.NVarChar(100), entry.referenceNo)
          .query(`SELECT TOP (1) id FROM dbo.financial_transactions WITH (UPDLOCK, HOLDLOCK)
            WHERE financial_account_id = @accountId AND reference_no = @referenceNo`);
        if (duplicate.recordset?.length) throw new FinanceServiceError('That reference number is already used for this account.', 409);
      }

      const previousBalanceCents = parseMoneyCents(account.balance, { allowNegative: true, allowZero: true });
      const direction = entry.transactionType === 'charge' ? 1n : entry.transactionType === 'payment' ? -1n : 1n;
      const nextBalanceCents = previousBalanceCents + (entry.amountCents * direction);
      if (nextBalanceCents > MAX_MONEY_CENTS || nextBalanceCents < -MAX_MONEY_CENTS) {
        throw new FinanceServiceError('This transaction would exceed the supported balance limit.');
      }
      const nextBalance = formatMoneyCents(nextBalanceCents);

      await transaction.request()
        .input('accountId', sql.Int, account.financial_account_id)
        .input('balance', sql.Decimal(12, 2), nextBalance)
        .query(`UPDATE dbo.financial_accounts SET balance = @balance, updated_at = SYSUTCDATETIME()
          WHERE id = @accountId`);
      const inserted = await transaction.request()
        .input('accountId', sql.Int, account.financial_account_id)
        .input('transactionType', sql.NVarChar(30), entry.transactionType)
        .input('amount', sql.Decimal(12, 2), entry.amount)
        .input('description', sql.NVarChar(500), entry.description)
        .input('referenceNo', sql.NVarChar(100), entry.referenceNo)
        .input('actorId', sql.Int, actor.id)
        .query(`INSERT INTO dbo.financial_transactions
          (financial_account_id, transaction_type, amount, description, reference_no, recorded_by)
          OUTPUT INSERTED.id AS id
          VALUES (@accountId, @transactionType, @amount, @description, @referenceNo, @actorId)`);
      const transactionId = inserted.recordset?.[0]?.id;
      if (!Number.isSafeInteger(transactionId) || transactionId < 1) throw new Error('Financial transaction insert returned no identifier.');
      await writeAudit(transaction, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'transaction_recorded',
        entityId: account.financial_account_id,
        details: {
          transactionId,
          transactionType: entry.transactionType,
          amount: entry.amount,
          referenceNo: entry.referenceNo
        }
      });
      return { accountId: account.financial_account_id, transactionId, balance: nextBalance };
    });
  }

  return { searchStudents, listRecentAccounts, getStudentAccount, getDashboardSummary, createAccount, recordTransaction };
}

module.exports = {
  FinanceServiceError,
  createFinanceService,
  normalizeId,
  normalizeSearchTerm,
  parseMoneyCents,
  formatMoneyCents,
  validateTransaction,
  isUniqueConflict
};
