const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { getPool, closePool, sql } = require('../src/config/database');
const environment = require('../src/config/environment');

const PASSWORD_HASH_ROUNDS = 12;
const DEMO_VERSION = 'prototype-v1';
const CREDENTIAL_FILE = path.resolve(__dirname, '../.env.demo');
const CREDENTIAL_KEYS = [
  'DEMO_REGISTRAR_EMAIL', 'DEMO_REGISTRAR_PASSWORD',
  'DEMO_FINANCE_EMAIL', 'DEMO_FINANCE_PASSWORD',
  'DEMO_STUDENT_1_EMAIL', 'DEMO_STUDENT_1_PASSWORD',
  'DEMO_STUDENT_2_EMAIL', 'DEMO_STUDENT_2_PASSWORD',
  'DEMO_STUDENT_3_EMAIL', 'DEMO_STUDENT_3_PASSWORD'
];

class DemoSeedError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DemoSeedError';
    this.status = status;
  }
}

function parseOptions(args, nodeEnv = process.env.NODE_ENV || 'development') {
  if (nodeEnv !== 'development') throw new DemoSeedError('Demo data can only be seeded when NODE_ENV=development.');
  if (!Array.isArray(args) || args.some((argument) => !['--apply', '--dry-run'].includes(argument))) {
    throw new DemoSeedError('Choose exactly one option: --dry-run or --apply.');
  }
  const modes = args.filter((argument) => argument === '--apply' || argument === '--dry-run');
  if (modes.length !== 1) throw new DemoSeedError('Choose exactly one option: --dry-run or --apply.');
  return { mode: modes[0] === '--apply' ? 'apply' : 'dry-run' };
}

function assertDevelopmentTarget(configuration = environment) {
  if (configuration.nodeEnv !== 'development') throw new DemoSeedError('Demo data can only be seeded when NODE_ENV=development.');
  const database = configuration.database || {};
  const localServers = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localServers.has(String(database.server || '').toLowerCase()) || database.database !== 'ARKTIESIIS') {
    throw new DemoSeedError('Demo data can only be applied to the local ARKTIESIIS database.');
  }
}

function deriveDemoEmails(smtpUser) {
  const normalized = typeof smtpUser === 'string' ? smtpUser.trim().toLowerCase() : '';
  const match = normalized.match(/^([a-z0-9.]+)(?:\+[a-z0-9._-]+)?@(gmail\.com|googlemail\.com)$/);
  if (!match || !match[1] || match[1].length > 64) {
    throw new DemoSeedError('Set SMTP_USER to a valid Gmail or Googlemail address before preparing demo accounts.');
  }
  const localPart = match[1];
  const domain = match[2];
  const aliases = {
    registrar: 'arkt-demo-registrar',
    finance: 'arkt-demo-finance',
    student1: 'arkt-demo-student-1',
    student2: 'arkt-demo-student-2',
    student3: 'arkt-demo-student-3'
  };
  const emails = Object.fromEntries(Object.entries(aliases).map(([key, suffix]) => {
    if (localPart.length + suffix.length + 1 > 64) {
      throw new DemoSeedError('SMTP_USER is too long to form safe Gmail demo aliases.');
    }
    return [key, `${localPart}+${suffix}@${domain}`];
  }));
  return emails;
}

function buildDemoPlan(emails) {
  const students = [
    { key: 'student1', studentNo: 'DEMO-001', firstName: 'Demo', lastName: 'Learner One', email: emails.student1, grades: ['91.00', '88.50', '94.00'] },
    { key: 'student2', studentNo: 'DEMO-002', firstName: 'Demo', lastName: 'Learner Two', email: emails.student2, grades: ['85.00', '90.00', '87.50'] },
    { key: 'student3', studentNo: 'DEMO-003', firstName: 'Demo', lastName: 'Learner Three', email: emails.student3, grades: ['96.00', '92.00', '89.50'] }
  ];
  const subjects = [
    { code: 'DEMO-CS101', name: 'Demo Computer Literacy', units: '3.00' },
    { code: 'DEMO-ENG101', name: 'Demo Communication Skills', units: '3.00' },
    { code: 'DEMO-MATH101', name: 'Demo Applied Mathematics', units: '4.00' }
  ];
  const ledgers = [
    [
      { type: 'charge', amount: '1000.00', description: 'Demo tuition charge', reference: 'DEMO-001-CHARGE-1' },
      { type: 'charge', amount: '250.00', description: 'Demo activity fee', reference: 'DEMO-001-CHARGE-2' },
      { type: 'payment', amount: '400.00', description: 'Demo payment', reference: 'DEMO-001-PAYMENT-1' }
    ],
    [
      { type: 'charge', amount: '1200.00', description: 'Demo tuition charge', reference: 'DEMO-002-CHARGE-1' },
      { type: 'payment', amount: '1200.00', description: 'Demo payment', reference: 'DEMO-002-PAYMENT-1' }
    ],
    [
      { type: 'charge', amount: '750.00', description: 'Demo tuition charge', reference: 'DEMO-003-CHARGE-1' },
      { type: 'payment', amount: '800.00', description: 'Demo payment', reference: 'DEMO-003-PAYMENT-1' }
    ]
  ];
  const financialAccounts = students.map((student, index) => {
    const transactions = ledgers[index];
    const balanceCents = transactions.reduce((balance, entry) => {
      const cents = decimalToCents(entry.amount);
      return balance + (entry.type === 'charge' ? cents : -cents);
    }, 0n);
    return { studentKey: student.key, transactions, balance: centsToDecimal(balanceCents) };
  });
  return {
    version: DEMO_VERSION,
    staff: [
      { key: 'registrar', email: emails.registrar, role: 'registrar', employeeNo: 'DEMO-STAFF-REG-001', firstName: 'Demo', lastName: 'Registrar', department: 'Prototype' },
      { key: 'finance', email: emails.finance, role: 'finance', employeeNo: 'DEMO-STAFF-FIN-001', firstName: 'Demo', lastName: 'Finance', department: 'Prototype' }
    ],
    students,
    term: { schoolYear: 'DEMO-2026', term: 'Prototype 1' },
    section: { name: 'DEMO Section A', gradeLevel: 'Demo Level' },
    subjects,
    financialAccounts
  };
}

function decimalToCents(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new DemoSeedError('Demo ledger amounts must be positive PHP decimals.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function centsToDecimal(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function formatCredentials(emails, passwords) {
  const values = {
    DEMO_REGISTRAR_EMAIL: emails.registrar,
    DEMO_REGISTRAR_PASSWORD: passwords.registrar,
    DEMO_FINANCE_EMAIL: emails.finance,
    DEMO_FINANCE_PASSWORD: passwords.finance,
    DEMO_STUDENT_1_EMAIL: emails.student1,
    DEMO_STUDENT_1_PASSWORD: passwords.student1,
    DEMO_STUDENT_2_EMAIL: emails.student2,
    DEMO_STUDENT_2_PASSWORD: passwords.student2,
    DEMO_STUDENT_3_EMAIL: emails.student3,
    DEMO_STUDENT_3_PASSWORD: passwords.student3
  };
  return `# Local development demo credentials. Do not commit or share this file.\n${CREDENTIAL_KEYS.map((key) => `${key}=${values[key]}`).join('\n')}\n`;
}

function parseCredentialFile(contents, emails) {
  const values = Object.fromEntries(contents.split(/\r?\n/)
    .map((line) => line.match(/^(DEMO_[A-Z0-9_]+)=([^\r\n]*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]));
  if (CREDENTIAL_KEYS.some((key) => typeof values[key] !== 'string')) {
    throw new DemoSeedError('The existing .env.demo file is incomplete; restore the original file before seeding.');
  }
  const emailKeys = {
    DEMO_REGISTRAR_EMAIL: emails.registrar,
    DEMO_FINANCE_EMAIL: emails.finance,
    DEMO_STUDENT_1_EMAIL: emails.student1,
    DEMO_STUDENT_2_EMAIL: emails.student2,
    DEMO_STUDENT_3_EMAIL: emails.student3
  };
  for (const [key, expectedEmail] of Object.entries(emailKeys)) {
    if (values[key] !== expectedEmail) throw new DemoSeedError('The existing .env.demo aliases do not match SMTP_USER; preserve the file and resolve the mismatch before seeding.');
  }
  const passwords = {
    registrar: values.DEMO_REGISTRAR_PASSWORD,
    finance: values.DEMO_FINANCE_PASSWORD,
    student1: values.DEMO_STUDENT_1_PASSWORD,
    student2: values.DEMO_STUDENT_2_PASSWORD,
    student3: values.DEMO_STUDENT_3_PASSWORD
  };
  if (Object.values(passwords).some((password) => !/^[A-Za-z0-9_-]{32,}$/.test(password))) {
    throw new DemoSeedError('The existing .env.demo passwords are invalid; restore the original file before seeding.');
  }
  return { emails, passwords };
}

function loadOrCreateCredentials({ smtpUser, filePath = CREDENTIAL_FILE, fileSystem = fs, randomPassword = () => crypto.randomBytes(24).toString('base64url') }) {
  const emails = deriveDemoEmails(smtpUser);
  try {
    const stat = fileSystem.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new DemoSeedError('.env.demo must be a regular local file.');
    fileSystem.chmodSync(filePath, 0o600);
    return parseCredentialFile(fileSystem.readFileSync(filePath, 'utf8'), emails);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const passwords = Object.fromEntries(['registrar', 'finance', 'student1', 'student2', 'student3']
    .map((key) => [key, randomPassword()]));
  if (Object.values(passwords).some((password) => typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(password))) {
    throw new DemoSeedError('A strong demo password could not be generated.');
  }
  try {
    fileSystem.writeFileSync(filePath, formatCredentials(emails, passwords), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return loadOrCreateCredentials({ smtpUser, filePath, fileSystem, randomPassword });
    throw error;
  }
  fileSystem.chmodSync(filePath, 0o600);
  return { emails, passwords };
}

async function seedDemoData({
  getDatabasePool = getPool,
  sqlTypes = sql,
  transactionFactory = (pool) => new sqlTypes.Transaction(pool),
  credentials,
  runtime = environment,
  hashPassword = bcrypt.hash
} = {}) {
  assertDevelopmentTarget(runtime);
  if (!credentials?.emails || !credentials?.passwords) throw new DemoSeedError('Demo credentials are required before seeding.');
  const plan = buildDemoPlan(credentials.emails);
  const staffPasswords = credentials.passwords;
  const passwordHashes = new Map(await Promise.all([
    ...plan.staff.map(async (staff) => [staff.key, await hashPassword(staffPasswords[staff.key], PASSWORD_HASH_ROUNDS)]),
    ...plan.students.map(async (student) => [student.key, await hashPassword(staffPasswords[student.key], PASSWORD_HASH_ROUNDS)])
  ]));
  const pool = await getDatabasePool();
  const transaction = transactionFactory(pool);
  let started = false;
  try {
    await transaction.begin(sqlTypes.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const marker = await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), plan.version)
      .query(`SELECT TOP (1) id FROM dbo.audit_logs WITH (UPDLOCK, HOLDLOCK)
        WHERE action = @action AND entity_type = @entityType AND entity_id = @entityId`);
    if (marker.recordset?.length) {
      await transaction.commit();
      started = false;
      return { alreadySeeded: true, staffCount: plan.staff.length, studentCount: plan.students.length };
    }

    const emails = [...plan.staff.map((staff) => staff.email), ...plan.students.map((student) => student.email)];
    const employeeNumbers = plan.staff.map((staff) => staff.employeeNo);
    const studentNumbers = plan.students.map((student) => student.studentNo);
    const subjectCodes = plan.subjects.map((subject) => subject.code);
    const userConflict = await transaction.request()
        .input('email0', sqlTypes.NVarChar(255), emails[0]).input('email1', sqlTypes.NVarChar(255), emails[1])
        .input('email2', sqlTypes.NVarChar(255), emails[2]).input('email3', sqlTypes.NVarChar(255), emails[3])
        .input('email4', sqlTypes.NVarChar(255), emails[4])
        .query(`SELECT TOP (1) id FROM dbo.users WITH (UPDLOCK, HOLDLOCK)
          WHERE email IN (@email0, @email1, @email2, @email3, @email4)`);
    const studentConflict = await transaction.request()
        .input('studentNo0', sqlTypes.NVarChar(50), studentNumbers[0]).input('studentNo1', sqlTypes.NVarChar(50), studentNumbers[1])
        .input('studentNo2', sqlTypes.NVarChar(50), studentNumbers[2])
        .query(`SELECT TOP (1) id FROM dbo.students WITH (UPDLOCK, HOLDLOCK)
          WHERE student_no IN (@studentNo0, @studentNo1, @studentNo2)`);
    const staffConflict = await transaction.request()
        .input('employeeNo0', sqlTypes.NVarChar(50), employeeNumbers[0]).input('employeeNo1', sqlTypes.NVarChar(50), employeeNumbers[1])
        .query(`SELECT TOP (1) id FROM dbo.staff_profiles WITH (UPDLOCK, HOLDLOCK)
          WHERE employee_no IN (@employeeNo0, @employeeNo1)`);
    const termConflict = await transaction.request()
        .input('schoolYear', sqlTypes.NVarChar(20), plan.term.schoolYear).input('term', sqlTypes.NVarChar(30), plan.term.term)
        .query(`SELECT TOP (1) id FROM dbo.academic_terms WITH (UPDLOCK, HOLDLOCK)
          WHERE school_year = @schoolYear AND term = @term`);
    const subjectConflict = await transaction.request()
        .input('subjectCode0', sqlTypes.NVarChar(50), subjectCodes[0]).input('subjectCode1', sqlTypes.NVarChar(50), subjectCodes[1])
        .input('subjectCode2', sqlTypes.NVarChar(50), subjectCodes[2])
        .query(`SELECT TOP (1) id FROM dbo.subjects WITH (UPDLOCK, HOLDLOCK)
          WHERE subject_code IN (@subjectCode0, @subjectCode1, @subjectCode2)`);
    if (userConflict.recordset?.length || studentConflict.recordset?.length || staffConflict.recordset?.length || termConflict.recordset?.length || subjectConflict.recordset?.length) {
      throw new DemoSeedError('A demo email, student number, employee number, term, or subject code already exists without the demo seed marker. No records were changed.', 409);
    }

    const userIds = new Map();
    for (const account of plan.staff) {
      const inserted = await transaction.request()
        .input('email', sqlTypes.NVarChar(255), account.email)
        .input('passwordHash', sqlTypes.NVarChar(255), passwordHashes.get(account.key))
        .input('role', sqlTypes.NVarChar(30), account.role)
        .query(`INSERT INTO dbo.users (email, password_hash, role, is_active)
          OUTPUT INSERTED.id AS id VALUES (@email, @passwordHash, @role, 1)`);
      const userId = inserted.recordset?.[0]?.id;
      if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Demo staff account insert returned no identifier.');
      userIds.set(account.key, userId);
      await transaction.request()
        .input('userId', sqlTypes.Int, userId)
        .input('firstName', sqlTypes.NVarChar(100), account.firstName)
        .input('lastName', sqlTypes.NVarChar(100), account.lastName)
        .input('employeeNo', sqlTypes.NVarChar(50), account.employeeNo)
        .input('department', sqlTypes.NVarChar(100), account.department)
        .query(`INSERT INTO dbo.staff_profiles (user_id, employee_no, first_name, last_name, department)
          VALUES (@userId, @employeeNo, @firstName, @lastName, @department)`);
    }
    for (const student of plan.students) {
      const insertedUser = await transaction.request()
        .input('email', sqlTypes.NVarChar(255), student.email)
        .input('passwordHash', sqlTypes.NVarChar(255), passwordHashes.get(student.key))
        .input('role', sqlTypes.NVarChar(30), 'student')
        .query(`INSERT INTO dbo.users (email, password_hash, role, is_active)
          OUTPUT INSERTED.id AS id VALUES (@email, @passwordHash, @role, 1)`);
      const userId = insertedUser.recordset?.[0]?.id;
      if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Demo student account insert returned no identifier.');
      userIds.set(student.key, userId);
    }

    const termResult = await transaction.request()
      .input('schoolYear', sqlTypes.NVarChar(20), plan.term.schoolYear)
      .input('term', sqlTypes.NVarChar(30), plan.term.term)
      .query(`INSERT INTO dbo.academic_terms (school_year, term, is_current)
        OUTPUT INSERTED.id AS id VALUES (@schoolYear, @term, 0)`);
    const termId = termResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(termId) || termId < 1) throw new Error('Demo term insert returned no identifier.');
    const sectionResult = await transaction.request()
      .input('name', sqlTypes.NVarChar(100), plan.section.name)
      .input('gradeLevel', sqlTypes.NVarChar(50), plan.section.gradeLevel)
      .input('termId', sqlTypes.Int, termId)
      .query(`INSERT INTO dbo.sections (name, grade_level, academic_term_id)
        OUTPUT INSERTED.id AS id VALUES (@name, @gradeLevel, @termId)`);
    const sectionId = sectionResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(sectionId) || sectionId < 1) throw new Error('Demo section insert returned no identifier.');

    const studentIds = new Map();
    for (const student of plan.students) {
      const inserted = await transaction.request()
        .input('userId', sqlTypes.Int, userIds.get(student.key))
        .input('studentNo', sqlTypes.NVarChar(50), student.studentNo)
        .input('firstName', sqlTypes.NVarChar(100), student.firstName)
        .input('lastName', sqlTypes.NVarChar(100), student.lastName)
        .query(`INSERT INTO dbo.students (user_id, student_no, first_name, last_name)
          OUTPUT INSERTED.id AS id VALUES (@userId, @studentNo, @firstName, @lastName)`);
      const studentId = inserted.recordset?.[0]?.id;
      if (!Number.isSafeInteger(studentId) || studentId < 1) throw new Error('Demo student insert returned no identifier.');
      studentIds.set(student.key, studentId);
      const enrollment = await transaction.request()
        .input('studentId', sqlTypes.Int, studentId)
        .input('termId', sqlTypes.Int, termId)
        .input('sectionId', sqlTypes.Int, sectionId)
        .query(`INSERT INTO dbo.enrollments (student_id, academic_term_id, section_id)
          OUTPUT INSERTED.id AS id VALUES (@studentId, @termId, @sectionId)`);
      const enrollmentId = enrollment.recordset?.[0]?.id;
      if (!Number.isSafeInteger(enrollmentId) || enrollmentId < 1) throw new Error('Demo enrollment insert returned no identifier.');
      student.enrollmentId = enrollmentId;
    }

    const subjectIds = new Map();
    for (const subject of plan.subjects) {
      const inserted = await transaction.request()
        .input('code', sqlTypes.NVarChar(50), subject.code)
        .input('name', sqlTypes.NVarChar(200), subject.name)
        .input('units', sqlTypes.Decimal(5, 2), subject.units)
        .query(`INSERT INTO dbo.subjects (subject_code, subject_name, units)
          OUTPUT INSERTED.id AS id VALUES (@code, @name, @units)`);
      const subjectId = inserted.recordset?.[0]?.id;
      if (!Number.isSafeInteger(subjectId) || subjectId < 1) throw new Error('Demo subject insert returned no identifier.');
      subjectIds.set(subject.code, subjectId);
    }
    for (const student of plan.students) {
      for (let index = 0; index < plan.subjects.length; index += 1) {
        const subject = plan.subjects[index];
        const assignment = await transaction.request()
          .input('enrollmentId', sqlTypes.Int, student.enrollmentId)
          .input('subjectId', sqlTypes.Int, subjectIds.get(subject.code))
          .query(`INSERT INTO dbo.student_subjects (enrollment_id, subject_id)
            OUTPUT INSERTED.id AS id VALUES (@enrollmentId, @subjectId)`);
        const assignmentId = assignment.recordset?.[0]?.id;
        if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) throw new Error('Demo subject assignment insert returned no identifier.');
        await transaction.request()
          .input('studentSubjectId', sqlTypes.Int, assignmentId)
          .input('gradingPeriod', sqlTypes.NVarChar(50), 'Demo Period 1')
          .input('gradeValue', sqlTypes.Decimal(6, 2), student.grades[index])
          .input('recordedBy', sqlTypes.Int, userIds.get('registrar'))
          .query(`INSERT INTO dbo.grades (student_subject_id, grading_period, grade_value, recorded_by)
            VALUES (@studentSubjectId, @gradingPeriod, @gradeValue, @recordedBy)`);
      }
    }

    const financeUserId = userIds.get('finance');
    for (const accountPlan of plan.financialAccounts) {
      const studentId = studentIds.get(accountPlan.studentKey);
      const account = await transaction.request()
        .input('studentId', sqlTypes.Int, studentId)
        .input('balance', sqlTypes.Decimal(12, 2), accountPlan.balance)
        .query(`INSERT INTO dbo.financial_accounts (student_id, balance)
          OUTPUT INSERTED.id AS id VALUES (@studentId, @balance)`);
      const accountId = account.recordset?.[0]?.id;
      if (!Number.isSafeInteger(accountId) || accountId < 1) throw new Error('Demo finance account insert returned no identifier.');
      for (const entry of accountPlan.transactions) {
        await transaction.request()
          .input('accountId', sqlTypes.Int, accountId)
          .input('transactionType', sqlTypes.NVarChar(30), entry.type)
          .input('amount', sqlTypes.Decimal(12, 2), entry.amount)
          .input('description', sqlTypes.NVarChar(500), entry.description)
          .input('referenceNo', sqlTypes.NVarChar(100), entry.reference)
          .input('recordedBy', sqlTypes.Int, financeUserId)
          .query(`INSERT INTO dbo.financial_transactions
            (financial_account_id, transaction_type, amount, description, reference_no, recorded_by)
            VALUES (@accountId, @transactionType, @amount, @description, @referenceNo, @recordedBy)`);
      }
    }

    await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), plan.version)
      .input('detailsJson', sqlTypes.NVarChar(sqlTypes.MAX), JSON.stringify({
        staffAccounts: plan.staff.length,
        studentAccounts: plan.students.length,
        subjects: plan.subjects.length,
        documents: 0,
        validationRows: 0
      }))
      .query(`INSERT INTO dbo.audit_logs (user_id, action, entity_type, entity_id, details_json)
        VALUES (NULL, @action, @entityType, @entityId, @detailsJson)`);

    await transaction.commit();
    started = false;
    return { alreadySeeded: false, staffCount: plan.staff.length, studentCount: plan.students.length };
  } catch (error) {
    if (started) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original error without exposing database details.
      }
    }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  let shouldClosePool = false;
  try {
    const { mode } = parseOptions(args, process.env.NODE_ENV || 'development');
    const emails = deriveDemoEmails(environment.smtp.user);
    const plan = buildDemoPlan(emails);
    if (mode === 'dry-run') {
      process.stdout.write(`Demo seed preview: ${plan.staff.length} staff accounts, ${plan.students.length} students, ${plan.subjects.length} subjects, ${plan.students.length} enrollments, ${plan.financialAccounts.length} finance accounts, ${plan.financialAccounts.reduce((count, account) => count + account.transactions.length, 0)} ledger entries. No database changes made.\n`);
      process.stdout.write('Applying requires NODE_ENV=development, --apply, and SMTP_USER set to a Gmail or Googlemail address.\n');
      return;
    }
    assertDevelopmentTarget(environment);
    const credentials = loadOrCreateCredentials({ smtpUser: environment.smtp.user });
    shouldClosePool = true;
    const result = await seedDemoData({ credentials });
    process.stdout.write(result.alreadySeeded
      ? 'Demo sample data already exists; no rows were added. Credentials remain in ignored .env.demo.\n'
      : 'Demo sample data created. Login emails and random passwords are in ignored .env.demo (owner-only permissions).\n');
  } catch (error) {
    process.stderr.write(`${error instanceof DemoSeedError ? error.message : 'Demo data seeding failed. Check local database connectivity and schema setup.'}\n`);
    process.exitCode = 1;
  } finally {
    if (shouldClosePool) {
      try {
        await closePool();
      } catch {
        // Do not print database connection details.
      }
    }
  }
}

if (require.main === module) main();

module.exports = {
  DemoSeedError,
  parseOptions,
  assertDevelopmentTarget,
  deriveDemoEmails,
  buildDemoPlan,
  decimalToCents,
  centsToDecimal,
  formatCredentials,
  parseCredentialFile,
  loadOrCreateCredentials,
  seedDemoData
};
