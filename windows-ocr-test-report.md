# Windows Phase 9 WIP Test Handoff Report

## Branch Details
- **Branch Checked Out:** `temp-main` (tracking `origin/main`)

## Environment Details
- **Windows Edition/Version:** Microsoft Windows 11 Home Single Language 10.0.26200 64-bit
- **PowerShell Version:** 5.1.26100.9444
- **Node Version:** v24.19.0
- **NPM Version:** 11.17.0
- **Executable Paths (Scoop & local Poppler used for un-elevated access):**
  - `TESSERACT_PATH`: `C:\Users\USER\scoop\apps\tesseract\current\tesseract.exe`
  - `PDFINFO_PATH`: `C:\Users\USER\poppler\poppler-24.07.0\Library\bin\pdfinfo.exe`
  - `PDFTOPPM_PATH`: `C:\Users\USER\poppler\poppler-24.07.0\Library\bin\pdftoppm.exe`
  - `TESSDATA_PREFIX`: `C:\Users\USER\scoop\apps\tesseract-languages\current`
- **Tesseract Version:** `v5.5.3.20260724` (`eng` language data available)
- **Poppler Version:** `24.07.0`

## Command Outputs and Exit Codes
- **`npm ci` (Exit Code 0):** added 167 packages, and audited 168 packages in 17s. 47 packages are looking for funding. 1 high severity vulnerability.
- **`npm run ocr:smoke` (Exit Code 0):** `OCR smoke passed for synthetic JPEG, PNG, and two-page PDF; page order and temporary-file cleanup verified.`
- **`npm run check` (Exit Code 0):** Syntax check passed without output.
- **`npm test` (Exit Code 1):** 125 tests passed, 2 failed. The two failures occurred in `tests\demo-seed.test.js` and `tests\documents.test.js` solely due to Windows POSIX translation issues. Node `fs.chmod` applied `0o666` (`438`) on Windows filesystems instead of the strict POSIX `0o600` (`384`) expected by the assertions. This is an expected artifact of local testing on a Windows host and not an application failure.

## Security Review Evidence
1. **Student Ownership:** Enforced in `src/services/documentService.js`. Both `listDocuments` and `getDocument` query restrict the actor by asserting `(role = 'student' AND s.user_id = @actorId)`.
2. **Document Type Restrictions (Form 137 & PSA Birth Certificate):** Restricting students is handled safely. `STUDENT_DOCUMENT_TYPES` strictly allows only `good_moral` and `report_card`. In `src/routes/documents.js`, staff upload endpoints are protected by `requireRole(...STAFF_ROLES)`, and `STAFF_ROLES` equals `['registrar', 'database_admin']`.
3. **Staff-Only OCR Text:** Implemented strictly. The OCR validation history queries in `src/services/documentService.js` use an `EXISTS (SELECT 1 FROM dbo.users WHERE role IN ('registrar', 'database_admin'))` block when returning the `extracted_text`. It will drop the text for students. 
4. **Finance Role Document Denial:** The finance role is correctly absent from `STAFF_ROLES` and `requireReadActor`, explicitly denying them document visibility.
5. **Feature Scope Validation:** Confirmed. The processing features only extract OCR text and describe validation. The application does not claim to authenticate signatures, verify seals, detect forgery, or perform forensic document analysis.

## Remaining Acceptance Gates
Phase 10 remains strictly paused until the school provides the approved required fields, format/compliance rules, human-review cases, and decision wording.

*This report constitutes Windows WIP evidence for Phase 9. No database migrations were applied to a live database.*
