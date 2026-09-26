# Paper Objectives, Scope, and Limitations

This document organizes the objectives, scope, and limitations supplied for the thesis paper. The final section records implementation clarifications separately so application behavior is not presented as school policy or as wording from the paper.

## General objective

Develop a web-based information management system with an AI-assisted document verification module to improve the efficiency, accuracy, and organization of student records and document processing at Ark Technological Institute Education System Incorporated - Lucena Branch.

## Specific objectives

1. Centralize student information, including personal data, enrollment, grades, financial accounts, and academic history.
2. Allow students and staff to upload Form 137, PSA birth certificates, report cards, and Good Moral Certificates in PDF, JPEG, or PNG format. Form 137 is restricted to authorized staff such as the registrar and database administrator.
3. Allow administrative staff, including the registrar, finance staff, and database administrator, to create, read, update, and delete permitted student records. The registrar and database administrator can deactivate student accounts.
4. Use an existing AI document-processing service to automatically check uploaded documents for required information, completeness, and configured format rules. A registrar may perform manual verification when needed.

## Scope

### Platform and access

- The system serves Ark Technological Institute Education System Incorporated - Lucena Branch. It is not a general multi-school platform.
- Users sign in with assigned credentials and complete email-based two-factor authentication.
- The system presents role-appropriate functions and protects records according to the user's role.

### Database administrator module

- Manage user accounts and oversee student, academic, finance, and document records and system activity.
- Create, update, and oversee student information, academic history, and finance accounts.
- Manage finance accounts, tuition balances, payments, and account status.
- Monitor uploaded documents and their validation results.
- Maintain the master list of students by class, section, and subject, including enrollment counts.
- Support data consistency, storage integrity, and database backup operations.

### Registrar module

- Create, read, and update academic information, including grades and enrollment records.
- Search and manage student records and view the student master list.
- View a student's submitted documents and their validation status.
- Review documents, accept them when the applicable process permits, request a corrected re-upload, or perform manual verification when needed.
- Manage the academic documents listed in the objectives, subject to role restrictions and institution-approved requirements.

### Finance module

- Read and update student-linked finance accounts, balances, payments, and account status.
- Access finance information needed for the finance role.

### Student module

- Access only the student's own permitted records.
- View grades, including subjects and grading periods.
- Upload and view Good Moral Certificates and report cards.
- View document validation results and re-upload a corrected document when requested.

### Document processing

- Accept PDF, JPEG, and PNG uploads for the document types in scope.
- Have the uploader choose the document type before upload; the AI service does not classify documents.
- Use an existing document-processing service for OCR/text extraction, required-field checks, completeness validation, and configured format/compliance checks.
- Keep human review available when the result needs judgment or when document acceptance requires it.

## Limitations

- The project uses existing local OCR/document-processing software. It does not train or introduce a new AI model.
- Validation is limited to OCR/text extraction, required information, completeness, and configured format/compliance checks.
- The uploader selects the document type. Automatic document classification is outside scope.
- The system does not claim to prove document authenticity, detect forged documents, authenticate signatures or seals, examine paper/material authenticity, or perform forensic document analysis. Human intervention is required for authenticity judgments.
- The system depends on server availability and installed local OCR/PDF utilities; the document OCR workflow does not require a cloud document-processing service.
- The implementation is limited to the Lucena Branch of Ark Technological Institute Education System Incorporated.

## Implementation clarifications kept separate from the paper and school policy

These capstone leader decisions guide application behavior. They preserve the paper's wording above and must not be described as institutional policy:

- Although specific objective 2 broadly lists all four document types for students and staff, the implementation decision is that students may upload only Good Moral Certificates and report cards. Registrar/database administrator users may upload those types and PSA birth certificates. A student may view/download only a PSA birth certificate uploaded by staff for that student's own record.
- The paper's specific objective lists Form 137 among the uploads by authorized staff; that source wording is preserved above. The current application does not permit persistent Form 137 file uploads. Only registrar/database administrator users may send a scan of the physical paper for temporary local OCR suggestions; the temporary file is deleted after processing and no Form 137 document or OCR record is created. The only saved data is the human-recorded physical status and instruction. Form 137 status values are pending, received, verified, correction, or rejected. Students see status/instruction only; historical Form 137 files remain staff-only.
- Digital OCR checks are advisory and limited to OCR-readable clues: linked student-name text and possible school-name lines for report cards and Good Moral Certificates; and linked student-name text for PSA certificates. There is no school-name whitelist, grade threshold, completeness/format rule, or automatic acceptance. A registrar/database administrator inspects the source file and manually verifies, requests correction, or rejects each digital submission. A reason is required to verify after OCR failure or a missed advisory check. The Phase 10 thesis implementation gate has passed; the separate school-adoption gate remains pending institution signoff before school deployment under these rules.
- A separate academic-records feature supports registrar review and confirmation of cached Term 1–3 and Final Grade values from the corrected SSHS E-Class Record for SY 2026–2027. It matches by LRN to an existing student, enrollment, section, grade level, and assigned subject; this workbook-specific import is a separate grade source and does not set institution-wide grading or document-acceptance policy or change the pending school-adoption gate.
- The paper's confirmed-deletion language applies to database-administrator deletion of student records. In the application, the user's chosen behavior is to archive/deactivate the student record while retaining linked academic and finance history. Separately, a registrar may deactivate a linked student login without archiving the student record.
- A registrar cannot edit an existing student number. A database administrator may correct it.
- The application's current 0–100 grade range is provisional, not a grading policy stated in the paper. The school must confirm its grading scale before the range is represented as official policy.
- The implementation uses local Tesseract OCR and Poppler PDF utilities for text extraction. These tools do not classify document types or make authenticity judgments.
