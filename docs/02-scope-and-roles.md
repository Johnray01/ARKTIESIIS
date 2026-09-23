# Scope and Roles

## Authentication
- Login for students, registrar, finance, and database administrator.
- Email-based two-factor authentication after valid credentials.
- Role-based redirect and server-side authorization.

## Database Administrator
- User account management.
- Full system oversight according to approved school policy.
- Student master list.
- Read-only oversight of subject and grade records; registrar users own academic record writes.
- Document oversight and validation result monitoring.
- Audit/activity monitoring.
- Data consistency and system maintenance functions.

## Registrar
- Student information management.
- Enrollment and academic history.
- Create and update the subject catalog, assign subjects to existing enrollments, and create or update grades by grading period.
- Student master list.
- Grade/academic record management.
- Authorized document management and review.
- May upload/manage restricted documents such as Form 137 and PSA birth certificates according to school policy.

## Finance
- Student financial account access.
- Record approved charges, payments, balances, or adjustments according to the final thesis requirements.
- No academic/system-admin privileges.

## Student
- Access only the student's own account and records.
- View grades.
- Upload permitted documents: Good Moral Certificate and report card.
- View document validation status and re-upload when corrections are required.
- No access to another student's records.

## Academic grade scale
Until the school confirms its grading policy, grade entry uses a provisional numeric range of 0–100 with up to two decimal places. The application accepts a staff-provided grading period label and does not prescribe period names. This provisional range is centralized in the academic records service for later adjustment.

## Document types
Initial approved types:
- Form 137
- Report Card
- Good Moral Certificate
- PSA Birth Certificate

Students may upload only Good Moral Certificates and report cards. Form 137 and PSA birth certificates are restricted to registrar and database administrator workflows; server routes must enforce these role rules.
