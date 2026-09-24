CREATE TABLE dbo.document_decision_events (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    document_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    decision_type NVARCHAR(40) NOT NULL
        CHECK (decision_type IN ('verified', 'correction_requested', 'rejected')),
    reason NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_document_decision_event_document
        FOREIGN KEY (document_id) REFERENCES dbo.documents(id),
    CONSTRAINT FK_document_decision_event_reviewer
        FOREIGN KEY (reviewer_id) REFERENCES dbo.users(id),
    CONSTRAINT CK_document_decision_event_reason
        CHECK ((decision_type = 'verified') OR (reason IS NOT NULL AND LEN(LTRIM(RTRIM(reason))) > 0))
);

CREATE INDEX IX_document_decision_events_document_created
    ON dbo.document_decision_events (document_id, created_at DESC, id DESC);

CREATE TABLE dbo.form137_status_events (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    student_id INT NOT NULL,
    recorded_by INT NOT NULL,
    status NVARCHAR(30) NOT NULL
        CHECK (status IN ('pending', 'received', 'verified', 'correction', 'rejected')),
    instruction NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_form137_status_student
        FOREIGN KEY (student_id) REFERENCES dbo.students(id),
    CONSTRAINT FK_form137_status_recorder
        FOREIGN KEY (recorded_by) REFERENCES dbo.users(id),
    CONSTRAINT CK_form137_status_correction_instruction
        CHECK (status <> 'correction' OR (instruction IS NOT NULL AND LEN(LTRIM(RTRIM(instruction))) > 0))
);

CREATE INDEX IX_form137_status_events_student_created
    ON dbo.form137_status_events (student_id, created_at DESC, id DESC);
