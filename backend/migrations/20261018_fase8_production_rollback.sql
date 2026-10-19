-- ==============================================================================
-- AGROPASCO DIGITAL — PLAN DE ROLLBACK SEGURO CON PRESERVACIÓN DE DATOS (FASE 8)
-- Archivo: scratch/fase8_production_rollback.sql
-- ==============================================================================
-- REGLA DE ORO DE SEGURIDAD OPERACIONAL:
-- 1. Si solo se revierte el código de la aplicación (Render a commit 235d39f4),
--    NO SE DEBE EJECUTAR ESTE SCRIPT. El esquema nuevo es retrocompatible y no rompe
--    la versión estable anterior. Mantener las tablas preserva las acciones de mitigación
--    registradas por agricultores y notas de asesores técnicos.
-- 2. Este script SOLO debe ejecutarse si la reversión del esquema en base de datos
--    es estrictamente necesaria por decisión de arquitectura.
-- 3. ESTE SCRIPT NO ELIMINA DATOS DE FORMA DESTRUCTIVA:
--    Crea automáticamente tablas de archivo histórico (backup_archive_*) para preservar
--    el 100% de los registros generados por usuarios antes de desacoplar el esquema.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- FASE A: PRESERVACIÓN Y ARCHIVADO DE SEGURIDAD
-- ==============================================================================

-- 1. Respaldar acciones de mitigación registradas por agricultores y asesores
CREATE TABLE IF NOT EXISTS backup_archive_mitigation_actions AS
SELECT *, NOW() AS archived_at FROM mitigation_actions;

-- 2. Respaldar tareas ejecutadas y resultados del sistema multiagente
CREATE TABLE IF NOT EXISTS backup_archive_agent_tasks AS
SELECT *, NOW() AS archived_at FROM agent_tasks;

-- 3. Respaldar bitácora de cumplimiento y auditoría de agentes
CREATE TABLE IF NOT EXISTS backup_archive_agent_audit_logs AS
SELECT *, NOW() AS archived_at FROM agent_audit_logs;

-- 4. Respaldar historial de predicciones persistidas y evaluaciones
CREATE TABLE IF NOT EXISTS backup_archive_ml_predictions_log AS
SELECT *, NOW() AS archived_at FROM ml_predictions_log;

-- 5. Respaldar asignaciones de parcelas a asesores técnicos
CREATE TABLE IF NOT EXISTS backup_archive_advisor_parcel_assignments AS
SELECT *, NOW() AS archived_at FROM advisor_parcel_assignments;


-- ==============================================================================
-- FASE B: DESACOPLE SEGURO DE TABLAS OPERACIONALES DE FASE 8
-- ==============================================================================
-- Se eliminan solo las 6 tablas operacionales agregadas por el motor ML y multiagente.
-- Las tablas base (users, crops, parcels, products, purchase_orders, etc.) NO SE TOCAN.

DROP TABLE IF EXISTS advisor_parcel_assignments CASCADE;
DROP TABLE IF EXISTS scheduler_locks CASCADE;
DROP TABLE IF EXISTS ml_predictions_log CASCADE;
DROP TABLE IF EXISTS agent_audit_logs CASCADE;
DROP TABLE IF EXISTS agent_tasks CASCADE;
DROP TABLE IF EXISTS mitigation_actions CASCADE;

-- ==============================================================================
-- FASE C: LIMPIEZA DE COLUMNAS AUXILIARES EN NOTIFICATIONS
-- ==============================================================================
-- Eliminar solo las columnas auxiliares agregadas en Fase 7, manteniendo la tabla intacta.
ALTER TABLE notifications DROP COLUMN IF EXISTS horizon;
ALTER TABLE notifications DROP COLUMN IF EXISTS risk_level;
ALTER TABLE notifications DROP COLUMN IF EXISTS risk_score;

COMMIT;

-- ==============================================================================
-- RESUMEN DE EJECUCIÓN POST-ROLLBACK:
-- Las tablas de respaldo 'backup_archive_*' quedan disponibles en la base de datos
-- para consulta, auditoría o restauración posterior en caso de requerirse.
-- ==============================================================================
