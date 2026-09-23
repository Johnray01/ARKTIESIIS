ALTER TABLE dbo.documents
ADD supersedes_document_id INT NULL;
GO

ALTER TABLE dbo.documents
ADD CONSTRAINT FK_document_supersedes_document
    FOREIGN KEY (supersedes_document_id) REFERENCES dbo.documents(id);

ALTER TABLE dbo.documents
ADD CONSTRAINT CK_document_not_superseding_itself
    CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> id);

CREATE UNIQUE INDEX UX_documents_supersedes_document_id
    ON dbo.documents (supersedes_document_id)
    WHERE supersedes_document_id IS NOT NULL;

CREATE TABLE dbo.document_review_events (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    document_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    action_type NVARCHAR(40) NOT NULL
        CHECK (action_type IN ('review_requested', 'correction_requested')),
    instruction NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_document_review_event_document
        FOREIGN KEY (document_id) REFERENCES dbo.documents(id),
    CONSTRAINT FK_document_review_event_reviewer
        FOREIGN KEY (reviewer_id) REFERENCES dbo.users(id),
    CONSTRAINT CK_document_review_event_instruction
        CHECK ((action_type = 'correction_requested' AND instruction IS NOT NULL)
            OR action_type = 'review_requested')
);

CREATE INDEX IX_document_review_events_document_created
    ON dbo.document_review_events (document_id, created_at DESC, id DESC);
