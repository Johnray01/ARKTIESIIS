# Scripts

Place one-off development or maintenance scripts here. Keep production application logic inside `src/`.

## Native OCR smoke check

After installing Tesseract with English language data and Poppler (`pdfinfo`, `pdftoppm`), configure `TESSERACT_PATH`, `PDFINFO_PATH`, and `PDFTOPPM_PATH` if needed, then run:

```bash
npm run ocr:smoke
```

This uses synthetic JPEG, PNG, and two-page PDF fixtures to check real text extraction, PDF page order, and temporary-file cleanup. It does not connect to SQL Server or modify application data. On Windows, configure paths in PowerShell before running the command; paths with spaces are supported.

Example PowerShell setup (adjust the Poppler directory if needed):

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
