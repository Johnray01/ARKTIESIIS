# Windows OCR compatibility handoff

Paste this prompt into Antigravity on the Windows computer for supplemental path compatibility evidence. The Phase 9 native OCR acceptance run is on Linux; this Windows check does not satisfy or replace it.

````text
Check Windows executable-path compatibility for the current ARKTIESIIS local OCR code. Use the repository and whichever branch is currently checked out. Do not assume or change the branch name. Preserve all existing worktree changes. This is supplemental compatibility evidence only: Phase 9 native OCR acceptance requires a real Linux run.

First inspect `git status --short` and `git branch --show-current`, then read `AGENTS.md`, `README.md`, `docs/04-document-ai.md`, `docs/07-paper-objectives-scope-limitations.md`, `docs/08-phase-8-to-15-goal-plan.md`, and `scripts/README.md`. Follow the project's role and document-access rules.

Use Node.js 20 or newer. From the repository root, run the mocked compatibility test and project checks, recording their complete output and exit codes:

```text
npm ci
node --test tests/localOcrService.test.js
npm run check
npm test
```

Run each later command even if an earlier check fails, when feasible. The focused test mocks native command execution and verifies that Windows paths containing spaces are passed as single executable arguments without a shell. It is not a live Windows OCR test. Do not use credentials, `.env` secrets, a live database, or real student documents. Do not apply migrations or make database changes. Do not report a Windows run as the Phase 9 native-runtime gate.

Review the relevant document routes, services, views, and tests. Report whether server-side access checks enforce student ownership, restrict persistent uploads to the permitted roles and document types, prohibit persistent Form 137 uploads, allow only registrar/database administrator users to record Form 137 status or submit a temporary scan, keep OCR text and scan suggestions staff-only, and deny finance document access. Cite the files/functions inspected and relevant test results. Confirm the feature describes OCR/text extraction and advisory checks only; it must not claim to prove authenticity, detect forgery, or verify signatures or seals.

Leader-directed advisory checks and human-review controls are implemented. Policy-dependent checks remain pending school approval of type-specific required fields and format/compliance rules for Form 137, report cards, Good Moral Certificates, and PSA birth certificates, along with any institution-defined review cases and decision wording. Do not invent or implement school policy, start Phase 11, edit application files, commit, or push as part of this validation. Do not declare the policy-dependent acceptance gate complete.

Return a concise report with the branch name and source revision, Windows/Node/npm versions, exact command outputs and exit codes, security review evidence, and any failures or unresolved setup issues. Identify this as supplemental mocked Windows path-compatibility evidence. The real Linux native OCR smoke remains the Phase 9 runtime gate; the historical report is not current-checkout acceptance evidence. Distinguish test-harness coverage from a live authenticated Form 137 route run.
````
