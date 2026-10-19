-- ==============================================================================
-- AGROPASCO DIGITAL — MIGRACIÓN PRODUCCIÓN (FASES 5, 6 Y 7: MOTOR PREDICTIVO Y MLOPS)
-- Archivo: scratch/fase8_production_migration.sql
-- Propósito: DDL idempotente para desplegar las tablas operacionales y de soporte ML.
-- Tablas nuevas:
--   1. mitigation_actions (Fase 5 - Catálogo y seguimiento agronómico)
--   2. agent_tasks (Fase 6 - Orquestador DAG de tareas multiagente)
--   3. agent_audit_logs (Fase 6 - Auditoría y verificación de gobernanza de agentes)
--   4. ml_predictions_log (Fase 7 - Registro persistente para inferencias y verificación ground truth)
--   5. scheduler_locks (Fase 7 - Control de concurrencia y leases distribuidos en Node/Render)
--   6. advisor_parcel_assignments (Fase 7 - Aislamiento RBAC estricto para asesores)
-- Columnas añadidas:
--   - notifications (horizon, risk_level, risk_score)
-- SEGURIDAD: Idempotente (IF NOT EXISTS), transaccional (BEGIN...COMMIT), sin operaciones destructivas.
-- ==============================================================================

BEGIN;

-- Establecer lock_timeout preventivo de 5 segundos para evitar bloqueos prolongados en tablas de produccion
SET lock_timeout = '5s';

-- 1. mitigation_actions (Fase 5)
CREATE TABLE IF NOT EXISTS mitigation_actions (
    id SERIAL PRIMARY KEY,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id TEXT NOT NULL,
    phenomenon TEXT NOT NULL,
    action_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'en_proceso', 'realizada', 'no_aplicable')),
    horizon TEXT NOT NULL DEFAULT '24h',
    risk_level TEXT NOT NULL DEFAULT 'moderate',
    priority TEXT NOT NULL DEFAULT 'alta',
    time_window TEXT,
    resources_needed TEXT,
    precautions TEXT,
    notes TEXT,
    advisor_notes TEXT,
    advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_parcel_strategy UNIQUE (parcel_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_mitigation_parcel_id ON mitigation_actions(parcel_id);
CREATE INDEX IF NOT EXISTS idx_mitigation_status ON mitigation_actions(status);

-- 2. agent_tasks (Fase 6)
CREATE TABLE IF NOT EXISTS agent_tasks (
    id VARCHAR(64) PRIMARY KEY,
    workflow_type VARCHAR(64) NOT NULL,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    current_agent VARCHAR(64) NOT NULL DEFAULT 'orchestrator',
    steps TEXT NOT NULL DEFAULT '{}',
    result_summary TEXT,
    error_message TEXT,
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 2,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_parcel_id ON agent_tasks(parcel_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks(created_at DESC);

-- 3. agent_audit_logs (Fase 6)
CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(64) REFERENCES agent_tasks(id) ON DELETE CASCADE,
    parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    agent_name VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    compliance_status VARCHAR(32) NOT NULL DEFAULT 'verified' CHECK(compliance_status IN ('verified', 'warning', 'violation')),
    verification_details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_task_id ON agent_audit_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON agent_audit_logs(created_at DESC);

-- 4. ml_predictions_log (Fase 7)
CREATE TABLE IF NOT EXISTS ml_predictions_log (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(64) REFERENCES agent_tasks(id) ON DELETE SET NULL,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    emitted_at TIMESTAMPTZ DEFAULT NOW(),
    target_date DATE NOT NULL,
    horizon VARCHAR(16) NOT NULL,
    phenomenon VARCHAR(32) NOT NULL,
    probability DOUBLE PRECISION NOT NULL,
    risk_score DOUBLE PRECISION NOT NULL,
    risk_level VARCHAR(32) NOT NULL,
    model_name VARCHAR(64) NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    weather_source VARCHAR(128) NOT NULL,
    validity_status VARCHAR(32) DEFAULT 'active' CHECK(validity_status IN ('active', 'evaluated', 'expired', 'stale')),
    evaluation_result VARCHAR(32) DEFAULT 'pending' CHECK(evaluation_result IN ('pending', 'hit', 'miss', 'false_alarm', 'correct_negative', 'unverified')),
    observation_id INTEGER REFERENCES ground_truth_observations(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_pred_parcel_target ON ml_predictions_log(parcel_id, target_date, phenomenon);
CREATE INDEX IF NOT EXISTS idx_ml_pred_validity ON ml_predictions_log(validity_status);

-- 5. scheduler_locks (Fase 7)
CREATE TABLE IF NOT EXISTS scheduler_locks (
    job_name VARCHAR(64) PRIMARY KEY,
    locked_by VARCHAR(128) NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_status VARCHAR(32) DEFAULT 'idle',
    last_error TEXT
);

-- 6. advisor_parcel_assignments (Fase 7)
CREATE TABLE IF NOT EXISTS advisor_parcel_assignments (
    id SERIAL PRIMARY KEY,
    advisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    active INTEGER DEFAULT 1,
    CONSTRAINT unique_advisor_parcel UNIQUE (advisor_id, parcel_id)
);

CREATE INDEX IF NOT EXISTS idx_advisor_parcel_active ON advisor_parcel_assignments(advisor_id, parcel_id, active);

-- 7. Modificación idempotente de tabla notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS horizon VARCHAR(16);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS risk_level VARCHAR(32);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION;

COMMIT;
