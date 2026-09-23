/* Phase 3: persistent per-user verification and delivery limits. */
SET XACT_ABORT ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.schema_migrations WHERE [version] = '002'
    )
    BEGIN
        IF OBJECT_ID('dbo.two_factor_auth_limits', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.two_factor_auth_limits (
                user_id INT NOT NULL PRIMARY KEY,
                failed_attempts INT NOT NULL CONSTRAINT DF_two_factor_limits_failed_attempts DEFAULT 0,
                failed_window_started_at DATETIME2 NOT NULL CONSTRAINT DF_two_factor_limits_failed_window DEFAULT SYSUTCDATETIME(),
                send_count INT NOT NULL CONSTRAINT DF_two_factor_limits_send_count DEFAULT 0,
                send_window_started_at DATETIME2 NOT NULL CONSTRAINT DF_two_factor_limits_send_window DEFAULT SYSUTCDATETIME(),
                last_sent_at DATETIME2 NULL,
                CONSTRAINT CK_two_factor_limits_failed_attempts CHECK (failed_attempts >= 0),
                CONSTRAINT CK_two_factor_limits_send_count CHECK (send_count >= 0),
                CONSTRAINT FK_two_factor_limits_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
            );
        END;

        INSERT INTO dbo.schema_migrations ([version]) VALUES ('002');
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
