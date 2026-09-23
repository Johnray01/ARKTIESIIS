# Database setup

`schema.sql` is the one-time SQL Server baseline for a fresh ARKTIESIIS database. It creates the project database, its initial tables and constraints, and records baseline version `001` in `dbo.schema_migrations`. Run it once in SQL Server with an account allowed to create the database and schema objects.

The baseline includes constraints for a single current academic term, section and enrollment term consistency, one grade per student subject and grading period, unique stored document filenames, and positive document file sizes. `psa_birth_certificate` is an allowed document type in the schema; application routes must restrict it to registrar and database administrator roles.

After a database has been initialized, make schema changes with new, numbered, forward-only migration scripts and record each applied version in `dbo.schema_migrations`. Do not edit or rerun the baseline to upgrade an existing database, and do not modify old migration scripts after they have been applied.

After configuring `.env`, run `npm run db:check` to verify SQL Server connectivity and confirm that baseline version `001` is recorded.
