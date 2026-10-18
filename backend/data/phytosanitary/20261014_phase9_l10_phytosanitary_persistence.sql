-- ==============================================================================
-- AgroPasco Digital — Migración Versionada Fitosanitaria
-- Archivo: 20261014_phase9_l10_phytosanitary_persistence.sql
-- FASE 9-L10: Persistencia Relacional Segura, Transacciones y Auditoría Durable
-- ==============================================================================
-- ESTADO: MIGRACIÓN DOCUMENTAL Y VERSIONADA — NO APLICADA EN PRODUCCIÓN.
-- Cumple con las restricciones de gobernanza de AgroPasco Digital.
-- Requiere ejecución controlada exclusivamente en entornos autorizados.
-- ==============================================================================

-- 1. Tabla Principal de Avisos Fitosanitarios Oficiales
CREATE TABLE IF NOT EXISTS phytosanitary_notices (
    id VARCHAR(64) PRIMARY KEY,                         -- Identificador canónico (ej: SENASA-AF-2024-001)
    source_institution VARCHAR(32) NOT NULL,            -- SENASA, MIDAGRI, MINAGRI, INIA, SENAMHI
    official_title TEXT NOT NULL,                       -- Título formal del aviso
    official_document_number VARCHAR(128),              -- Número oficial de resolución o directiva
    official_url TEXT,                                  -- URL institucional con HTTPS verificado
    notice_type VARCHAR(64) NOT NULL,                   -- Tipo clasificado (alerta, emergencia, etc.)
    pest_scientific_name VARCHAR(128),                  -- Nombre científico normalizado
    pest_common_name VARCHAR(128),                      -- Nombre común
    affected_crops JSONB DEFAULT '[]'::jsonb,           -- Lista canónica de cultivos afectados
    geographical_scope JSONB NOT NULL,                  -- Ámbito estructurado { country, department, provinces, districts }
    geographical_scope_type VARCHAR(32) NOT NULL,       -- nacional, departamental, provincial, distrital
    issue_date DATE NOT NULL,                           -- Fecha de emisión oficial
    effective_from DATE,                                -- Inicio de vigencia
    effective_until DATE,                               -- Fin de vigencia oficial
    publication_status VARCHAR(32) DEFAULT 'vigente',   -- vigente, en_revision, retirado, sustituido, derogado, expirado
    verification_status VARCHAR(32) NOT NULL DEFAULT 'discovered', -- discovered, pending_verification, verified, review_required, approved, active, rejected, withdrawn, superseded
    source_verified_at TIMESTAMPTZ,                     -- Momento de verificación de fuente
    ingestion_timestamp TIMESTAMPTZ DEFAULT NOW(),      -- Momento de ingesta
    original_document_hash VARCHAR(128),                -- Hash SHA-256 de la resolución original
    severity_official VARCHAR(32) DEFAULT 'no_especificada', -- Severidad oficial
    priority_internal VARCHAR(32) DEFAULT 'normal',     -- Prioridad calculada internamente
    recommended_public_action TEXT NOT NULL,            -- Acción preventiva recomendada
    requires_human_review BOOLEAN DEFAULT FALSE,        -- Bandera de triaje obligatorio
    is_official BOOLEAN DEFAULT FALSE,                  -- Origen oficial confirmado (por defecto falso hasta comprobación)
    is_synthetic BOOLEAN DEFAULT FALSE,                 -- Aislamiento de datos de prueba
    supersedes_notice_id VARCHAR(64) REFERENCES phytosanitary_notices(id) ON DELETE SET NULL,
    superseded_by VARCHAR(64),                          -- ID del aviso sustituto
    withdrawn_at TIMESTAMPTZ,                           -- Momento de retiro
    withdrawn_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Usuario que ejecutó el retiro
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- Administrador que aprobó formalmente
    approved_by_name VARCHAR(128),                      -- Nombre del administrador aprobador
    approved_at TIMESTAMPTZ,                            -- Momento de aprobación
    previous_approval JSONB,                            -- Histórico de aprobación previa invalidada
    safety_flags JSONB DEFAULT '[]'::jsonb,             -- Banderas de cuarentena y bioseguridad
    provenance JSONB NOT NULL,                          -- Trazabilidad de origen y canal
    verification_evidence JSONB,                        -- Evidencia documental institucional
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- Usuario creador
    created_by_name VARCHAR(128),                       -- Nombre del creador
    created_by_role VARCHAR(32),                        -- Rol del creador al momento del registro
    version INTEGER NOT NULL DEFAULT 1,                 -- Control de versiones optimista
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_pn_version_positive CHECK (version > 0),
    CONSTRAINT chk_pn_approved_complete CHECK (
        verification_status != 'approved' OR (
            approved_at IS NOT NULL AND
            verification_evidence IS NOT NULL AND
            (approved_by_user_id IS NOT NULL OR approved_by_name IS NOT NULL)
        )
    ),
    CONSTRAINT chk_pn_withdrawn_complete CHECK (
        verification_status != 'withdrawn' OR (
            withdrawn_at IS NOT NULL
        )
    )
);

-- Índices optimizados para consultas del catálogo
CREATE INDEX IF NOT EXISTS idx_pn_status ON phytosanitary_notices (verification_status, publication_status);
CREATE INDEX IF NOT EXISTS idx_pn_institution ON phytosanitary_notices (source_institution);
CREATE INDEX IF NOT EXISTS idx_pn_notice_type ON phytosanitary_notices (notice_type);
CREATE INDEX IF NOT EXISTS idx_pn_severity ON phytosanitary_notices (severity_official);
CREATE INDEX IF NOT EXISTS idx_pn_issue_date ON phytosanitary_notices (issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_pn_affected_crops ON phytosanitary_notices USING GIN (affected_crops);
CREATE INDEX IF NOT EXISTS idx_pn_geo_scope ON phytosanitary_notices USING GIN (geographical_scope);

-- 2. Tabla de Revisiones Técnicas Agronómicas (Separación de Funciones)
CREATE TABLE IF NOT EXISTS phytosanitary_technical_reviews (
    id SERIAL PRIMARY KEY,
    notice_id VARCHAR(64) NOT NULL REFERENCES phytosanitary_notices(id) ON DELETE CASCADE,
    reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
    reviewer_name VARCHAR(128) NOT NULL,
    reviewer_role VARCHAR(32) NOT NULL CHECK(reviewer_role IN ('advisor', 'admin')),
    reviewed_at TIMESTAMPTZ DEFAULT NOW(),
    observations TEXT NOT NULL,                         -- Observaciones técnicas agronómicas
    recommended_status VARCHAR(32) NOT NULL,            -- review_required, verified, rejected
    evidence_reference TEXT,                            -- Referencia a informe o expediente técnico
    review_version INTEGER NOT NULL,                    -- Versión del aviso al momento de la revisión
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ptr_notice_version ON phytosanitary_technical_reviews (notice_id, review_version);
CREATE INDEX IF NOT EXISTS idx_ptr_reviewer ON phytosanitary_technical_reviews (reviewer_user_id);

-- 3. Tabla de Auditoría Inmutable y Durable (Append-Only)
CREATE TABLE IF NOT EXISTS phytosanitary_notice_history (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(64) UNIQUE NOT NULL,               -- Identificador único de evento
    notice_id VARCHAR(64) NOT NULL REFERENCES phytosanitary_notices(id) ON DELETE RESTRICT, -- Preservación obligatoria del historial
    from_status VARCHAR(32),                            -- Estado previo
    to_status VARCHAR(32) NOT NULL,                     -- Estado resultante
    previous_status VARCHAR(32),                        -- Alias canónico
    new_status VARCHAR(32) NOT NULL,                    -- Alias canónico
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Preservación de trazabilidad ante baja de usuario
    actor_role VARCHAR(32) NOT NULL,                    -- Rol del actor
    action VARCHAR(64) NOT NULL,                        -- NOTICE_REGISTERED, APPROVAL_INVALIDATED, etc.
    reason TEXT NOT NULL,                               -- Justificación formal
    evidence_reference TEXT,                            -- Expediente o referencia probatoria
    details JSONB,                                      -- Información adicional estructurada
    event_timestamp TIMESTAMPTZ DEFAULT NOW(),          -- Timestamp del suceso
    record_version INTEGER NOT NULL,                    -- Versión del aviso registrada
    correlation_id VARCHAR(64),                         -- Correlación transaccional
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pnh_notice_id ON phytosanitary_notice_history (notice_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_pnh_event_id ON phytosanitary_notice_history (event_id);
CREATE INDEX IF NOT EXISTS idx_pnh_actor ON phytosanitary_notice_history (actor_user_id);

-- 4. Protección Append-Only mediante Trigger (Prohibición estricta de UPDATE y DELETE en Auditoría)
CREATE OR REPLACE FUNCTION trg_block_phytosanitary_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación no permitida: El historial de auditoría fitosanitaria es append-only e inmutable (no se admite UPDATE ni DELETE).';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_phyto_history ON phytosanitary_notice_history;
CREATE TRIGGER trg_protect_phyto_history
BEFORE UPDATE OR DELETE ON phytosanitary_notice_history
FOR EACH ROW
EXECUTE FUNCTION trg_block_phytosanitary_history_mutation();

-- 5. Tabla de Evaluación de Relevancia Geográfica por Parcela (Fase L08/L10)
CREATE TABLE IF NOT EXISTS parcel_phytosanitary_evaluations (
    id SERIAL PRIMARY KEY,
    notice_id VARCHAR(64) NOT NULL REFERENCES phytosanitary_notices(id) ON DELETE CASCADE,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    relevance_status VARCHAR(64) NOT NULL,
    crop_matched BOOLEAN NOT NULL DEFAULT FALSE,
    geographic_matched BOOLEAN NOT NULL DEFAULT FALSE,
    evaluation_rationale TEXT,
    is_notification_candidate BOOLEAN DEFAULT FALSE,
    notification_dispatched BOOLEAN DEFAULT FALSE,
    dispatched_at TIMESTAMPTZ,
    evaluated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (notice_id, parcel_id)
);

CREATE INDEX IF NOT EXISTS idx_ppe_parcel ON parcel_phytosanitary_evaluations (parcel_id);
CREATE INDEX IF NOT EXISTS idx_ppe_candidate ON parcel_phytosanitary_evaluations (is_notification_candidate, notification_dispatched);
