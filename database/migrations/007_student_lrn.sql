ALTER TABLE dbo.students
    ADD lrn NVARCHAR(12) NULL;

GO

ALTER TABLE dbo.students
    ADD CONSTRAINT CK_students_lrn_format
    CHECK (lrn IS NULL OR (DATALENGTH(lrn) = 24 AND lrn NOT LIKE N'%[^0-9]%'));

CREATE UNIQUE INDEX UX_students_lrn
    ON dbo.students (lrn)
    WHERE lrn IS NOT NULL;

GO

CREATE TRIGGER dbo.TR_students_require_lrn_on_insert
ON dbo.students
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted WHERE lrn IS NULL)
        THROW 51007, 'A learner reference number is required for new student records.', 1;
END;
GO

CREATE TABLE dbo.grade_import_previews (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    uploaded_by INT NOT NULL,
    session_fingerprint CHAR(64) NOT NULL,
    school_year NVARCHAR(20) NOT NULL,
    grade_level NVARCHAR(50) NOT NULL,
    section_name NVARCHAR(100) NOT NULL,
    subject_id INT NOT NULL,
    subject_name NVARCHAR(200) NOT NULL,
    workbook_grade_level NVARCHAR(50) NOT NULL,
    workbook_section_name NVARCHAR(100) NOT NULL,
    workbook_subject_name NVARCHAR(200) NOT NULL,
    context_mismatch BIT NOT NULL DEFAULT 0,
    status NVARCHAR(20) NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ready', 'confirmed')),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at DATETIME2 NOT NULL,
    CONSTRAINT FK_grade_import_preview_user FOREIGN KEY (uploaded_by) REFERENCES dbo.users(id),
    CONSTRAINT FK_grade_import_preview_subject FOREIGN KEY (subject_id) REFERENCES dbo.subjects(id)
);

CREATE INDEX IX_grade_import_previews_expiry
    ON dbo.grade_import_previews (expires_at);

CREATE TABLE dbo.grade_import_preview_rows (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    preview_id UNIQUEIDENTIFIER NOT NULL,
    source_row INT NOT NULL,
    student_id INT NULL,
    enrollment_id INT NULL,
    student_subject_id INT NULL,
    student_no NVARCHAR(50) NULL,
    workbook_name NVARCHAR(200) NULL,
    student_name NVARCHAR(200) NULL,
    lrn_fingerprint CHAR(64) NULL,
    name_mismatch BIT NOT NULL DEFAULT 0,
    issue NVARCHAR(500) NULL,
    CONSTRAINT UQ_grade_import_preview_row UNIQUE (preview_id, source_row),
    CONSTRAINT FK_grade_import_preview_row_preview FOREIGN KEY (preview_id)
        REFERENCES dbo.grade_import_previews(id) ON DELETE CASCADE,
    CONSTRAINT FK_grade_import_preview_row_student FOREIGN KEY (student_id) REFERENCES dbo.students(id),
    CONSTRAINT FK_grade_import_preview_row_enrollment FOREIGN KEY (enrollment_id) REFERENCES dbo.enrollments(id),
    CONSTRAINT FK_grade_import_preview_row_assignment FOREIGN KEY (student_subject_id) REFERENCES dbo.student_subjects(id)
);

CREATE TABLE dbo.grade_import_preview_grades (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    preview_row_id BIGINT NOT NULL,
    grading_period NVARCHAR(50) NOT NULL,
    grade_value DECIMAL(6,2) NOT NULL,
    existing_grade_id INT NULL,
    existing_grade_value DECIMAL(6,2) NULL,
    CONSTRAINT UQ_grade_import_preview_grade_period UNIQUE (preview_row_id, grading_period),
    CONSTRAINT FK_grade_import_preview_grade_row FOREIGN KEY (preview_row_id)
        REFERENCES dbo.grade_import_preview_rows(id) ON DELETE CASCADE,
    CONSTRAINT FK_grade_import_preview_grade_existing FOREIGN KEY (existing_grade_id) REFERENCES dbo.grades(id)
);
