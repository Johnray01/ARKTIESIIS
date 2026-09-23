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
- Create and update student profiles, enrollment history, the subject catalog, subject assignments, and grades by grading period.
- Student master list.
- Deactivate linked student login accounts without archiving the student master record.
- Authorized document management and review.
- May upload/manage restricted documents such as Form 137 and PSA birth certificates according to school policy.

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
- View document validation status and re-upload when corrections are required.
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

Students may upload only Good Moral Certificates and report cards. Form 137 and PSA birth certificates are restricted to registrar and database administrator workflows; server routes must enforce these role rules.

The uploader chooses the document type before upload. AI work is limited to OCR/text extraction, required-field and completeness checks, and configured format/compliance checks. It does not classify documents or claim to prove authenticity, detect forgery, verify signatures or seals, or perform forensic analysis. Human review remains part of acceptance when needed.
