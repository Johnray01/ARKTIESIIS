# Database setup

`schema.sql` is the one-time SQL Server baseline for a fresh ARKTIESIIS database. It creates the project database, its initial tables and constraints, and records baseline version `001` in `dbo.schema_migrations`. The local SQL Server 2022 container is defined in the repository's `compose.yaml` and keeps its data in the named `sqlserver_data` volume.

The baseline includes constraints for a single current academic term, section and enrollment term consistency, one grade per student subject and grading period, unique stored document filenames, and positive document file sizes. `psa_birth_certificate` is an allowed document type in the schema; application routes must restrict it to registrar and database administrator roles.

After a database has been initialized, make schema changes with new, numbered, forward-only migration scripts named like `003_description.sql`. The `npm run db:setup` command applies them in version order and records each version in `dbo.schema_migrations` in the same transaction. Apply `migrations/002_email_two_factor_limits.sql` after the baseline to create the per-account two-factor attempt and send counters. Migration `003_document_revisions_and_reviews.sql` links immutable document submissions and records correction/review handoffs. Migration `004_document_processing_recovery.sql` adds processing leases for stale OCR recovery. Migration `005_local_ocr_processor_default.sql` changes the default processor label to `Tesseract OCR` for new validation rows; existing validation rows keep their original labels. Do not edit or rerun the baseline to upgrade an existing database, and do not modify old migration scripts after they have been applied.

Uploaded documents are stored outside the public web directory in `storage/uploads` by default. Set `DOCUMENT_STORAGE_DIR` to an absolute or project-relative private directory when configuring the deployment. The application creates the directory with owner-only permissions and stored files with owner-only read/write permissions. No retention period or automatic deletion policy is configured.

## Local setup

1. Copy `.env.example` to `.env`, review Microsoft's SQL Server license terms, and set `ACCEPT_EULA=Y`. Set a unique `DB_PASSWORD` that satisfies SQL Server's password policy. The same value configures the local `sa` account and the application connection.
2. Start SQL Server with `docker compose up -d sqlserver`. Wait for the container logs to say SQL Server is ready: `docker compose logs -f sqlserver` (Ctrl+C exits the log view only).
3. Run `npm run db:setup` to create a fresh database from `schema.sql` and apply migrations, or to apply pending migrations to an initialized database.
4. Run `npm run db:check` to verify connectivity and confirm that versions `001` through `005` are recorded.

The Compose port is bound to `127.0.0.1` and the named volume preserves the database when the container is recreated. Setup requires `DB_NAME=ARKTIESIIS` because the baseline uses that fixed name. If the database already exists without `dbo.schema_migrations` or version `001`, setup stops rather than rerunning the baseline; inspect or restore that database before continuing. Setup prints actionable messages without printing SQL Server errors or credentials.

The baseline runs only when the database does not exist. For a new database, it creates version `001`, then `db:setup` applies every pending numbered migration. For an existing database, it applies only pending migrations. Re-running `npm run db:setup` is safe and reports when the database is already current.
