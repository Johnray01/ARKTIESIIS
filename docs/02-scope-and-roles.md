# Scope and Roles

## Authentication
- Login for students, registrar, finance, and database administrator.
- Email-based two-factor authentication after valid credentials.
- Role-based redirect and server-side authorization.

## Database Administrator
- User account management.
- Full system oversight of student, academic, and finance records according to approved school policy.
- Create and update student profiles, manage subject/grade records, and manage finance accounts and transactions.
- Archive student records while retaining linked academic and finance history; archiving disables the linked student login.
- Review activity through the audit log.
- Document oversight and validation result monitoring.
- Audit/activity monitoring.
- Data consistency and system maintenance functions.

## Registrar
- Student information management.
- Enrollment and academic history.
- Create and update student profiles, enrollment history, the subject catalog, subject assignments, and grades by grading period. Registrars can add an LRN to a legacy profile when blank; only database administrators can change a recorded LRN.
- Preview and confirm grade imports from the corrected SSHS E-Class Record for SY 2026–2027, matched by LRN to existing school-year enrollment and subject assignments.
- Student master list.
- Deactivate linked student login accounts without archiving the student master record.
- Authorized document management and review.
- May upload Good Moral Certificates, report cards, and PSA birth certificates for student records.
- Records Form 137 physical receipt/review status and instructions. No new Form 137 file or OCR is used in this workflow; historical Form 137 files stay staff-only.

## Finance
- Search for a student by name or student number and access only finance identifiers, account details, balances, and transaction history.
- Create a financial account explicitly, then record positive PHP charges and payments or nonzero signed PHP adjustments with a reason.
- Charge increases balance; payment decreases balance; a negative balance represents a credit.
- Finance users have no academic or system-administrator privileges.
- Database administrators also have finance workspace access and may create/update financial accounts and ledger entries.

## Student
- Access only the student's own account and records.
- View grades.
- Upload permitted documents: Good Moral Certificate and report card.
- View document status and correction instructions, and re-upload their own Good Moral Certificates and report cards when requested.
- View/download a PSA birth certificate uploaded by a registrar or database administrator for their own record; students cannot upload or re-upload PSA files.
- View their own Form 137 physical status and staff instruction; students cannot upload Form 137.
- No access to another student's records.
- Archived student records retain academic and finance history; the linked student login is inactive.

## Academic grade scale
Until the school confirms its grading policy, grade entry uses a provisional numeric range of 0–100 with up to two decimal places. The application accepts a staff-provided grading period label and does not prescribe period names. This provisional range is centralized in the academic records service for later adjustment.

## Document types
Initial approved types:
- Form 137
- Report Card
- Good Moral Certificate
- PSA Birth Certificate

Students may upload only Good Moral Certificates and report cards. Registrar/database administrator users may upload Good Moral Certificates, report cards, and PSA birth certificates. Students may view/download only a staff-uploaded PSA file belonging to their own record. Form 137 is a physical status workflow for registrar/database administrator users; it records pending, received, verified, correction, or rejected status and contains no new upload or OCR step. Historical Form 137 files are restricted to staff.

The uploader chooses the document type before upload. Digital OCR suggestions are advisory: they look for the linked student name and a possible school-name line on report cards and Good Moral Certificates, and the linked student name on PSA certificates. They do not use a school-name whitelist, grading thresholds, completeness rules, or automatic acceptance. A registrar/database administrator inspects each digital source and records verification, a correction request, or rejection. A reason is required to verify after an OCR failure or a missed advisory check. OCR does not classify documents or claim to prove authenticity, detect forgery, verify signatures or seals, or perform forensic analysis. These are capstone leader implementation decisions, not school policy; school approval is still required for policy-dependent Phase 10 acceptance checks.
