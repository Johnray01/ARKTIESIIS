# Security Checklist

- Passwords hashed with bcrypt.
- Email 2FA codes stored hashed and expire quickly.
- Session ID regenerated after authentication.
- Role checks on every protected server route.
- Students can only read their own student records.
- SQL queries are parameterized.
- Uploads have allowlisted MIME types/extensions.
- Upload size is limited.
- Uploaded files are not executable and are stored outside the public directory.
- File download routes re-check authorization.
- Secrets are kept in environment variables.
- Login and OTP endpoints are rate limited.
- Important record changes are logged.
- Production errors do not reveal SQL or stack details.
- Backups and restore tests are documented before deployment.
