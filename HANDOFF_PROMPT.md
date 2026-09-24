# Windows Phase 9 OCR test handoff

Paste this prompt into Antigravity on the Windows computer:

````text
Validate the current ARKTIESIIS Phase 9 local OCR work on this Windows computer. This is a WIP test handoff; Phase 9 is not complete until the project owner reviews the results and remaining acceptance gates. Use the repository and whichever branch is currently checked out. Do not assume or change the branch name. Preserve all existing worktree changes.

First inspect `git status --short` and `git branch --show-current`, then read `AGENTS.md`, `README.md`, `docs/04-document-ai.md`, `docs/07-paper-objectives-scope-limitations.md`, `docs/08-phase-8-to-15-goal-plan.md`, and `scripts/README.md`. Follow the project's role and document-access rules.

Prerequisites:
- Install Node.js 20 or newer.
- Install Tesseract OCR with the English `eng` trained data.
- Install Poppler for Windows with `pdfinfo.exe` and `pdftoppm.exe`.

In PowerShell, set the executable paths for this machine. Adjust these examples to the actual install locations; paths containing spaces are supported:

```powershell
$env:TESSERACT_PATH = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
$env:PDFINFO_PATH = 'C:\Program Files\poppler\Library\bin\pdfinfo.exe'
$env:PDFTOPPM_PATH = 'C:\Program Files\poppler\Library\bin\pdftoppm.exe'
```

Record Windows edition/version, PowerShell version, `node --version`, `npm --version`, the configured executable paths, Tesseract version and `eng` availability (`& $env:TESSERACT_PATH --list-langs`), and Poppler version output. Then run these commands from the repository root and capture their complete output and exit codes:

```powershell
npm ci
npm run ocr:smoke
npm run check
npm test
```

Run each later command even if an earlier check fails, when feasible. The smoke test uses synthetic fixtures; do not use credentials, `.env` secrets, a live database, or real student documents. Do not apply migrations or make database changes.

Review the relevant document routes and views, and report whether server-side access checks still enforce student ownership, restrict Form 137 and PSA birth certificates to registrar/database admin, keep OCR text staff-only, and deny finance document access. Cite the files/functions inspected and any relevant test results. Confirm the feature describes OCR/text extraction and completeness/format checks only; it must not claim to prove authenticity, detect forgery, or verify signatures or seals. Do not invent school rules or document requirements.

Phase 10 remains paused until the school provides approved required fields, format/compliance rules, human-review cases, and decision wording. Do not implement Phase 10 or start Phase 11. Do not edit application files, commit, push, or declare Phase 9 complete as part of this test handoff.

Return a concise report with the branch name, environment details, exact command outputs and exit codes, security review evidence, and any failures or unresolved setup issues. Clearly state that this is Windows WIP evidence and identify the remaining acceptance gates.
````
