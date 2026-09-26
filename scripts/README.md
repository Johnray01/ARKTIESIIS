# Scripts

Place one-off development or maintenance scripts here. Keep production application logic inside `src/`.

## Native OCR smoke check

After installing Tesseract with English language data and Poppler (`pdfinfo`, `pdftoppm`), configure `TESSERACT_PATH`, `PDFINFO_PATH`, and `PDFTOPPM_PATH` if needed, then run:

```bash
npm run ocr:smoke
```

This uses synthetic JPEG, PNG, and two-page PDF fixtures to check real text extraction, PDF page order, and temporary-file cleanup. The Phase 9 native-runtime acceptance run is on Linux with installed Tesseract, English trained data, and Poppler. It does not connect to SQL Server, modify application data, or exercise the authenticated digital upload or Form 137 scan route. Windows executable-path handling is covered by a mocked test in `tests/localOcrService.test.js`; the historical Windows report is compatibility evidence only.

To additionally exercise the private digital upload and processing services, plus the transient Form 137 scan service, with real local OCR and synthetic fixtures, run:

```bash
ARKTIESIIS_RUN_NATIVE_OCR_INTEGRATION=1 node --test tests/documentProcessing.test.js
```

These opt-in tests use injected in-memory transaction/read harnesses and temporary directories; they do not connect to SQL Server or use real student documents. They are skipped by the ordinary test suite unless the environment flag is set. The digital test verifies the extracted text is saved against the upload's document id and is available only through a registrar read; the Form 137 test verifies the scan buffer and staged files are cleared and OCR text is not returned.

Supplemental PowerShell path configuration for manually checking a Windows installation (adjust the Poppler directory if needed; this does not substitute for the Linux acceptance run):

```powershell
$env:TESSERACT_PATH = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
$env:PDFINFO_PATH = 'C:\Program Files\poppler\Library\bin\pdfinfo.exe'
$env:PDFTOPPM_PATH = 'C:\Program Files\poppler\Library\bin\pdftoppm.exe'
npm run ocr:smoke
```

## Demo records

Preview the local prototype data without connecting to SQL Server:

```bash
npm run demo:seed -- --dry-run
```

Apply it only to a development database with a configured Gmail or Googlemail `SMTP_USER`:

```bash
npm run demo:seed -- --apply
```

The command requires `NODE_ENV=development`, a loopback database server using the `ARKTIESIIS` database, and the explicit `--apply` flag. It creates demo registrar, finance, and student logins; three clearly labeled fake student records; one non-current demo term and section; sample subjects/grades; and finance accounts whose balances match their charge/payment ledger. It creates no document or OCR rows. If any stable demo email, student number, term, or subject code already exists without the seed marker, the transaction stops without changes. A completed seed rerun adds no rows.

On the first apply, random passwords and the Gmail plus-address aliases are stored in ignored `.env.demo` with mode `0600`. The command does not print passwords. Keep that file on the local machine and read it when signing in to the development prototype. The script never changes the existing database administrator or any existing account.

### Grade import and document samples

After the base demo seed has created its registrar account, preview and apply the matching grade-import context plus synthetic document submissions:

```bash
npm run demo:seed-samples -- --dry-run
npm run demo:seed-samples -- --apply
```

This separate seed has its own `grade-documents-v1` marker, requires `NODE_ENV=development` and the local `ARKTIESIIS` database, and is safe to rerun. It aborts before inserts if the demo student number/LRN, term, subject code, sample filenames, or demo registrar already conflict without the marker. It creates a demo learner with LRN `123456789012`, an enrolled `Grade 11 / STEM A` roster for `2026-2027`, and the `Oral Communication` subject assignment required by grade import. The workbook at `tests/fixtures/grade-import/corrected-mini.xlsx` matches this context and contains the same synthetic learner and cached grades.

The command also stores two OCR smoke-test files in private `storage/uploads` (or `DOCUMENT_STORAGE_DIR`) and lists them as `DEMO-SAMPLE-...-NOT-OFFICIAL` submissions. They remain `needs_review`; the seed creates no validation rows or review decisions. These files are generated fixtures for interface testing and do not represent valid school records or establish authenticity. The student, enrollment, subject assignment, document rows, and audit marker are inserted in one serializable transaction. If a database step fails, newly written files are removed. The storage directory must resolve outside `public`.

### Database administrator dashboard login

The prototype data is shared across role dashboards. The base seed creates registrar, finance, and three linked student accounts, but leaves the existing administrator untouched. To add a separate synthetic admin login for inspecting the database administrator dashboard, preview and apply this independent seed after the base demo seed:

```bash
npm run demo:seed-admin -- --dry-run
npm run demo:seed-admin -- --apply
```

This seed has its own `dashboard-admin-v1` marker. It requires `NODE_ENV=development`, the local `ARKTIESIIS` database, and a Gmail or Googlemail `SMTP_USER`. It adds one active `database_admin` user and matching `staff_profiles` row, refuses unmarked email or employee-number conflicts, and never changes the bootstrap administrator. Its random login credentials are appended to ignored `.env.demo` with owner-only permissions; the command does not print them.

The grade/document fixture learner is intentionally unlinked by its original seed so it can be used for registrar review first. To inspect those submissions from a student's own workspace, link that synthetic learner to a separate student login with this additional seed after the grade/document and admin seeds:

```bash
npm run demo:seed-document-student -- --dry-run
npm run demo:seed-document-student -- --apply
```

This independent seed has a `document-student-v1` marker. It requires the two existing `DEMO-SAMPLE-...-NOT-OFFICIAL` submissions to belong to `DEMO-GRADE-001`, regardless of their current review status, refuses a conflicting login or pre-existing student link, and atomically creates one student user, links `DEMO-GRADE-001`, and records its marker. The documents are initially seeded as `needs_review`; the link seed preserves any later review decisions. It appends the random login to `.env.demo` as `DEMO_DOCUMENT_STUDENT_EMAIL` and `DEMO_DOCUMENT_STUDENT_PASSWORD` without printing either value.

After applying the base, grade/document, admin, and document-student seeds, sign in at `/login` with the email/password key pair for the role to inspect in `.env.demo`:

- Database administrator: `DEMO_DATABASE_ADMIN_EMAIL` and `DEMO_DATABASE_ADMIN_PASSWORD`.
- Registrar: `DEMO_REGISTRAR_EMAIL` and `DEMO_REGISTRAR_PASSWORD`.
- Finance: `DEMO_FINANCE_EMAIL` and `DEMO_FINANCE_PASSWORD`.
- Students 1–3: the matching `DEMO_STUDENT_1`, `DEMO_STUDENT_2`, or `DEMO_STUDENT_3` email/password keys.
- Student document review: `DEMO_DOCUMENT_STUDENT_EMAIL` and `DEMO_DOCUMENT_STUDENT_PASSWORD`.

The shared synthetic records cover the dashboard and adjacent workflows: the admin account list, aggregate summary, and seeded audit events; registrar student, term, enrollment, subject, and grade views plus one grade-import roster and two `needs_review` sample documents; each linked student's own profile, enrollment, grades, and permitted document list; the document-review student's own view of both sample submissions; and finance accounts in due (`PHP 850.00`), settled (`PHP 0.00`), and credit (`PHP -50.00`) states with matching charge/payment history. The linked document-review learner has one enrollment and no posted grades so the registrar can inspect its grade-import context. All `DEMO-*` records and `DEMO-SAMPLE-...-NOT-OFFICIAL` files are local interface fixtures, not school records. OCR and review status remain advisory workflow data.
