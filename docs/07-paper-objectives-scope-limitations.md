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

- The project uses an existing AI/document-processing service. It does not train or introduce a new AI model.
- Validation is limited to OCR/text extraction, required information, completeness, and configured format/compliance checks.
- The uploader selects the document type. Automatic document classification is outside scope.
- The system does not claim to prove document authenticity, detect forged documents, authenticate signatures or seals, examine paper/material authenticity, or perform forensic document analysis. Human intervention is required for authenticity judgments.
- The system depends on a stable Internet connection and the availability of its server and cloud document-processing service.
- The implementation is limited to the Lucena Branch of Ark Technological Institute Education System Incorporated.

## Implementation clarifications kept separate from the paper

These decisions guide application behavior and must not be described as additional school policy:

- Although specific objective 2 broadly lists all four document types for students and staff, the detailed role rules govern implementation: students may upload only Good Moral Certificates and report cards; Form 137 and PSA birth certificates are restricted to the registrar and database administrator.
- The paper's confirmed-deletion language applies to database-administrator deletion of student records. In the application, the user's chosen behavior is to archive/deactivate the student record while retaining linked academic and finance history. Separately, a registrar may deactivate a linked student login without archiving the student record.
- A registrar cannot edit an existing student number. A database administrator may correct it.
- The application's current 0–100 grade range is provisional, not a grading policy stated in the paper. The school must confirm its grading scale before the range is represented as official policy.
