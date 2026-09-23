/* ARKTIESIIS starter schema - Microsoft SQL Server */

IF DB_ID('ARKTIESIIS') IS NULL
BEGIN
    CREATE DATABASE ARKTIESIIS;
END;
GO

USE ARKTIESIIS;
GO

CREATE TABLE schema_migrations (
    version NVARCHAR(50) NOT NULL PRIMARY KEY,
    applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    role NVARCHAR(30) NOT NULL CHECK (role IN ('database_admin','registrar','finance','student')),
    is_active BIT NOT NULL DEFAULT 1,
    email_verified_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE staff_profiles (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    employee_no NVARCHAR(50) NULL UNIQUE,
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    department NVARCHAR(100) NULL,
    CONSTRAINT FK_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
);
GO

CREATE TABLE students (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NULL UNIQUE,
    student_no NVARCHAR(50) NOT NULL UNIQUE,
    first_name NVARCHAR(100) NOT NULL,
    middle_name NVARCHAR(100) NULL,
    last_name NVARCHAR(100) NOT NULL,
    suffix NVARCHAR(20) NULL,
    birth_date DATE NULL,
    sex NVARCHAR(20) NULL,
    address NVARCHAR(500) NULL,
    phone NVARCHAR(50) NULL,
    status NVARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_student_user FOREIGN KEY (user_id) REFERENCES users(id)
);
GO

CREATE TABLE academic_terms (
    id INT IDENTITY(1,1) PRIMARY KEY,
    school_year NVARCHAR(20) NOT NULL,
    term NVARCHAR(30) NOT NULL,
    is_current BIT NOT NULL DEFAULT 0,
    UNIQUE (school_year, term)
);
GO

CREATE UNIQUE INDEX UX_academic_terms_single_current
    ON academic_terms (is_current)
    WHERE is_current = 1;
GO

CREATE TABLE sections (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    grade_level NVARCHAR(50) NULL,
    academic_term_id INT NOT NULL,
    CONSTRAINT UQ_section_id_term UNIQUE (id, academic_term_id),
    CONSTRAINT FK_section_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id)
);
GO

CREATE TABLE enrollments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    student_id INT NOT NULL,
    academic_term_id INT NOT NULL,
    section_id INT NULL,
    enrollment_status NVARCHAR(30) NOT NULL DEFAULT 'enrolled',
    enrolled_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UNIQUE (student_id, academic_term_id),
    CONSTRAINT FK_enrollment_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT FK_enrollment_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id),
    CONSTRAINT FK_enrollment_section_term FOREIGN KEY (section_id, academic_term_id)
        REFERENCES sections(id, academic_term_id)
);
GO

CREATE TABLE subjects (
    id INT IDENTITY(1,1) PRIMARY KEY,
    subject_code NVARCHAR(50) NOT NULL UNIQUE,
    subject_name NVARCHAR(200) NOT NULL,
    units DECIMAL(5,2) NULL
);
GO

CREATE TABLE student_subjects (
    id INT IDENTITY(1,1) PRIMARY KEY,
    enrollment_id INT NOT NULL,
    subject_id INT NOT NULL,
    UNIQUE (enrollment_id, subject_id),
    CONSTRAINT FK_student_subject_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
    CONSTRAINT FK_student_subject_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
GO

CREATE TABLE grades (
    id INT IDENTITY(1,1) PRIMARY KEY,
    student_subject_id INT NOT NULL,
    grading_period NVARCHAR(50) NOT NULL,
    grade_value DECIMAL(6,2) NULL,
    remarks NVARCHAR(100) NULL,
    recorded_by INT NOT NULL,
    recorded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_grade_student_subject_period UNIQUE (student_subject_id, grading_period),
    CONSTRAINT FK_grade_student_subject FOREIGN KEY (student_subject_id) REFERENCES student_subjects(id),
    CONSTRAINT FK_grade_user FOREIGN KEY (recorded_by) REFERENCES users(id)
);
GO

CREATE TABLE financial_accounts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    student_id INT NOT NULL UNIQUE,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_financial_account_student FOREIGN KEY (student_id) REFERENCES students(id)
);
GO

CREATE TABLE financial_transactions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    financial_account_id INT NOT NULL,
    transaction_type NVARCHAR(30) NOT NULL CHECK (transaction_type IN ('charge','payment','adjustment')),
    amount DECIMAL(12,2) NOT NULL,
    description NVARCHAR(500) NULL,
    reference_no NVARCHAR(100) NULL,
    recorded_by INT NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_financial_transaction_account FOREIGN KEY (financial_account_id) REFERENCES financial_accounts(id),
    CONSTRAINT FK_financial_transaction_user FOREIGN KEY (recorded_by) REFERENCES users(id)
);
GO

CREATE TABLE documents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    student_id INT NOT NULL,
    document_type NVARCHAR(50) NOT NULL CHECK (document_type IN ('form_137','report_card','good_moral','psa_birth_certificate')),
    original_filename NVARCHAR(255) NOT NULL,
    stored_filename NVARCHAR(255) NOT NULL UNIQUE,
    mime_type NVARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    uploaded_by INT NOT NULL,
    upload_source NVARCHAR(30) NOT NULL CHECK (upload_source IN ('student','registrar','database_admin')),
    status NVARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','valid','needs_review','rejected','failed')),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_document_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT FK_document_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
GO

CREATE TABLE document_validations (
    id INT IDENTITY(1,1) PRIMARY KEY,
    document_id INT NOT NULL,
    processor NVARCHAR(100) NOT NULL DEFAULT 'Google Document AI',
    extracted_text NVARCHAR(MAX) NULL,
    validation_json NVARCHAR(MAX) NULL,
    completeness_passed BIT NULL,
    format_passed BIT NULL,
    result_status NVARCHAR(30) NOT NULL CHECK (result_status IN ('valid','needs_review','failed')),
    reviewed_by INT NULL,
    reviewed_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_validation_document FOREIGN KEY (document_id) REFERENCES documents(id),
    CONSTRAINT FK_validation_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
GO

CREATE TABLE two_factor_codes (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    code_hash NVARCHAR(255) NOT NULL,
    expires_at DATETIME2 NOT NULL,
    consumed_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_two_factor_user FOREIGN KEY (user_id) REFERENCES users(id)
);
GO

CREATE TABLE audit_logs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NULL,
    action NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(100) NULL,
    entity_id NVARCHAR(100) NULL,
    details_json NVARCHAR(MAX) NULL,
    ip_address NVARCHAR(64) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
);
GO

INSERT INTO schema_migrations (version) VALUES ('001');
GO
