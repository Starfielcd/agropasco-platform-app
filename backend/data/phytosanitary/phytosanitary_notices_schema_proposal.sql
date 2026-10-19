-- ==============================================================================
-- AgroPasco Digital — Propuesta de Esquema DDL Fitosanitario Oficial
-- ==============================================================================
-- FASE 9-L08: Vigilancia Fitosanitaria Oficial, Trazabilidad e Ingesta Controlada
--
-- NOTA CRÍTICA DE GOBERNANZA:
-- Este script es DOCUMENTAL y de PROPUESTA ARQUITECTÓNICA para futuras fases.
-- NO se ejecuta en la base de datos de producción (Supabase/PostgreSQL) en la Fase L08.
-- Cumple con la restricción de cero migraciones en L08.
-- ==============================================================================

-- 1. Tabla de Avisos Fitosanitarios Oficiales
CREATE TABLE IF NOT EXISTS phytosanitary_notices (
    id VARCHAR(64) PRIMARY KEY,                         -- notice_id oficial normalizado (ej: SENASA-AF-2024-001)
    source_institution VARCHAR(32) NOT NULL,            -- SENASA, MIDAGRI, etc.
    official_title TEXT NOT NULL,                       -- Título formal
    official_document_number VARCHAR(128),              -- Número de Resolución Jefatural / Directoral
    official_url TEXT,                                  -- Enlace institucional público verificado
    notice_type VARCHAR(64) NOT NULL,                   -- alerta_fitosanitaria_declarada, emergencia, etc.
    pest_scientific_name VARCHAR(128),                  -- Nombre científico de la plaga
    pest_common_name VARCHAR(128),                      -- Nombre común o vernacular
    affected_crops JSONB DEFAULT '[]'::jsonb,           -- Arreglo de cultivos canónicos afectados
    geographical_scope JSONB NOT NULL,                  -- { country, department, provinces: [], districts: [] }
    geographical_scope_type VARCHAR(32) NOT NULL,       -- nacional, departamental, provincial, distrital
    issue_date DATE NOT NULL,                           -- Fecha oficial de emisión
    effective_from DATE,                                -- Inicio de vigencia
    effective_until DATE,                               -- Fin de vigencia oficial (NULL si indefinido)
    publication_status VARCHAR(32) DEFAULT 'vigente',   -- vigente, sustituido, derogado, expirado
    verification_status VARCHAR(32) NOT NULL,           -- discovered, verified, approved, active, etc.
    original_document_hash VARCHAR(128),                -- SHA-256 del PDF/documento oficial si disponible
    severity_official VARCHAR(32) DEFAULT 'vigilancia', -- Severidad reportada por la autoridad
    priority_internal VARCHAR(32) DEFAULT 'media',      -- Prioridad calculada por AgroPasco
    recommended_public_action TEXT NOT NULL,            -- Medida preventiva oficial (sin dosis químicas)
    requires_human_review BOOLEAN DEFAULT FALSE,        -- Bandera para triaje agronómico
    is_official BOOLEAN DEFAULT TRUE,                   -- Indica si proviene de canal oficial verificado
    is_synthetic BOOLEAN DEFAULT FALSE,                 -- Protege que datos de test no se publiquen
    supersedes_notice_id VARCHAR(64),                   -- Relación de sustitución normativa
    safety_flags JSONB DEFAULT '[]'::jsonb,             -- Banderas de cuarentena o bioseguridad
    provenance JSONB NOT NULL,                          -- Metadatos de ingesta, captura y canal
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices estratégicos para consultas y filtrado
CREATE INDEX IF NOT EXISTS idx_phyto_notices_status ON phytosanitary_notices (verification_status, publication_status);
CREATE INDEX IF NOT EXISTS idx_phyto_notices_type ON phytosanitary_notices (notice_type);
CREATE INDEX IF NOT EXISTS idx_phyto_notices_institution ON phytosanitary_notices (source_institution);
CREATE INDEX IF NOT EXISTS idx_phyto_notices_crops ON phytosanitary_notices USING GIN (affected_crops);

-- 2. Tabla de Auditoría y Trazabilidad del Ciclo de Vida
CREATE TABLE IF NOT EXISTS phytosanitary_notice_audits (
    id SERIAL PRIMARY KEY,
    notice_id VARCHAR(64) NOT NULL REFERENCES phytosanitary_notices(id) ON DELETE CASCADE,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    changed_by_user_id INTEGER REFERENCES users(id),
    changed_by_name VARCHAR(128) NOT NULL,
    reviewer_role VARCHAR(32) NOT NULL,                 -- admin, advisor, automated_system
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabla de Evaluación de Relevancia por Parcela y Registro de Notificaciones Candidatas
CREATE TABLE IF NOT EXISTS parcel_phytosanitary_evaluations (
    id SERIAL PRIMARY KEY,
    notice_id VARCHAR(64) NOT NULL REFERENCES phytosanitary_notices(id) ON DELETE CASCADE,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    relevance_status VARCHAR(64) NOT NULL,              -- applicable_scope_confirmed, potentially_relevant, etc.
    crop_matched BOOLEAN,
    geographic_matched BOOLEAN,
    evaluation_rationale TEXT,
    is_notification_candidate BOOLEAN DEFAULT FALSE,
    notification_dispatched BOOLEAN DEFAULT FALSE,
    dispatched_at TIMESTAMP WITH TIME ZONE,
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (notice_id, parcel_id)
);
