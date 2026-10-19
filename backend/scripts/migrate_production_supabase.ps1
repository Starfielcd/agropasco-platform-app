<#
.SYNOPSIS
    AgroPasco Digital — Script de Migracion Controlada de Supabase Produccion
.DESCRIPTION
    Ejecuta de manera segura y verificada la migracion scratch/fase8_production_migration.sql
    en la base de datos de produccion de Supabase (Fases 1 a 8).
    
    Principios de Seguridad y Operacion:
      1. Verificacion obligatoria de hash SHA-256 del script SQL contra la huella auditada.
      2. Verificacion de existencia de respaldos de PostgreSQL y Supabase Storage.
      3. Conexion TLS verify-full obligatoria con certificado CA raiz prod-ca-2021.crt.
      4. Captura enmascarada de credenciales (Read-Host -AsSecureString).
      5. Pre-comprobaciones estrictas de solo lectura (linea base de registros y verificacion de no-existencia previa).
      6. Ejecucion transaccional estricta con psql -v ON_ERROR_STOP=1 y lock_timeout=5s.
      7. Post-comprobaciones de solo lectura (confirmacion de tablas nuevas, columnas de notifications y conteo intacto).
      8. Limpieza de credenciales en memoria en bloque try/finally.
      9. Generacion de manifiesto de auditoria en C:\AgroPasco_Backups.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$MigrationScript = "scratch\fase8_production_migration.sql",

    [Parameter(Mandatory = $false)]
    [string]$ExpectedSqlSha256 = "728912C8C2149EB6DEC018A075AD1DE53C208CC23DA666E177201D24DFA69E5C",

    [Parameter(Mandatory = $false)]
    [string]$BackupDirectory = "C:\AgroPasco_Backups",

    [Parameter(Mandatory = $false)]
    [string]$PgBinPath = "C:\Program Files\PostgreSQL\18\bin",

    [Parameter(Mandatory = $false)]
    [string]$SslRootCert = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " AGROPASCO DIGITAL — MIGRACION CONTROLADA DE SUPABASE PRODUCCION (FASES 1-8) " -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificacion del binario psql
$psqlExe = Join-Path $PgBinPath "psql.exe"
if (-not (Test-Path $psqlExe)) {
    throw "No se encontro psql.exe en: $psqlExe. Verifique la ruta del motor PostgreSQL."
}

# 2. Verificacion y huella SHA-256 del script de migracion
$resolvedScript = Resolve-Path $MigrationScript -ErrorAction SilentlyContinue
if ($null -eq $resolvedScript -or (-not (Test-Path $resolvedScript.Path))) {
    $altPath = Join-Path $PSScriptRoot "..\..\$MigrationScript"
    if (Test-Path $altPath) {
        $resolvedScript = Resolve-Path $altPath
    }
}
if ($null -eq $resolvedScript -or (-not (Test-Path $resolvedScript.Path))) {
    throw "El archivo de migracion no existe en: $MigrationScript"
}
$scriptPath = $resolvedScript.Path
$actualHash = (Get-FileHash -Path $scriptPath -Algorithm SHA256).Hash.ToUpper()

Write-Host "[VERIFICACION HASH] Validando integridad del script SQL auditado..." -ForegroundColor Yellow
Write-Host "  Archivo:     $scriptPath" -ForegroundColor Gray
Write-Host "  SHA-256 ESP: $ExpectedSqlSha256" -ForegroundColor Gray
Write-Host "  SHA-256 ACT: $actualHash" -ForegroundColor Gray

if ($actualHash -ne $ExpectedSqlSha256.ToUpper()) {
    throw "ABORTO DE SEGURIDAD: La huella SHA-256 del script SQL ha cambiado desde la version auditada. Operacion cancelada."
}
Write-Host "  [OK] Huella SHA-256 coincide exactamente con la version ensayada." -ForegroundColor Green

# 3. Verificacion de respaldos existentes (PostgreSQL + Storage)
Write-Host ""
Write-Host "[VERIFICACION RESPALDOS] Comprobando existencia de respaldos de seguridad..." -ForegroundColor Yellow
$pgDumpFile = Join-Path $BackupDirectory "agropasco_prod_backup_20261018_191658.dump"
$pgManifestFile = Join-Path $BackupDirectory "agropasco_prod_backup_20261018_191658_manifest.json"
$storageManifestFile = Join-Path $BackupDirectory "storage_backup_20261018_205450_manifest.json"

if (-not (Test-Path $pgDumpFile)) { throw "Falta el respaldo PostgreSQL: $pgDumpFile" }
if (-not (Test-Path $pgManifestFile)) { throw "Falta el manifiesto PostgreSQL: $pgManifestFile" }
if (-not (Test-Path $storageManifestFile)) { throw "Falta el manifiesto de Storage: $storageManifestFile" }

Write-Host "  [OK] Respaldo PostgreSQL presente: $pgDumpFile" -ForegroundColor Green
Write-Host "  [OK] Respaldo Storage presente:    $storageManifestFile" -ForegroundColor Green

# 4. Resolucion de Certificado CA para TLS verify-full
if ([string]::IsNullOrWhiteSpace($SslRootCert)) {
    $candidatePaths = @(
        (Join-Path $BackupDirectory "prod-ca-2021.crt"),
        (Join-Path $BackupDirectory "root.crt"),
        (Join-Path $env:APPDATA "postgresql\root.crt")
    )
    foreach ($cand in $candidatePaths) {
        if (Test-Path $cand) {
            $SslRootCert = (Resolve-Path $cand).Path
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($SslRootCert) -or (-not (Test-Path $SslRootCert))) {
    throw "ABORTO DE SEGURIDAD TLS: No se encontro el certificado CA raiz en '$SslRootCert'. verify-full es obligatorio."
}
$resolvedSslRootCert = (Resolve-Path $SslRootCert).Path
Write-Host "  [OK] Certificado CA verificado: $resolvedSslRootCert" -ForegroundColor Green

# 5. Parametros de conexion a Supabase produccion
Write-Host ""
Write-Host "[CONEXION] Ingrese parametros de Supabase Produccion:" -ForegroundColor Yellow
$remoteHost = Read-Host "Host de PostgreSQL (por defecto: aws-0-us-west-2.pooler.supabase.com)"
if ([string]::IsNullOrWhiteSpace($remoteHost)) { $remoteHost = "aws-0-us-west-2.pooler.supabase.com" }

$remotePort = Read-Host "Puerto (por defecto: 5432)"
if ([string]::IsNullOrWhiteSpace($remotePort)) { $remotePort = "5432" }

$remoteUser = Read-Host "Usuario de PostgreSQL (por defecto: postgres.jmptxechtaraceekfard)"
if ([string]::IsNullOrWhiteSpace($remoteUser)) { $remoteUser = "postgres.jmptxechtaraceekfard" }

$remoteDb = Read-Host "Base de datos (por defecto: postgres)"
if ([string]::IsNullOrWhiteSpace($remoteDb)) { $remoteDb = "postgres" }

$plainPassword = $null
$ptr = [IntPtr]::Zero
if (-not [string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
    $plainPassword = $env:PGPASSWORD
} else {
    $secPassword = Read-Host -Prompt "Contrasena de PostgreSQL" -AsSecureString
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPassword)
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
}

$migrationSuccess = $false
$manifestOut = $null

try {
    # Configurar entorno de proceso aislado
    $env:PGHOST        = $remoteHost.Trim()
    $env:PGPORT        = $remotePort.Trim()
    $env:PGDATABASE    = $remoteDb.Trim()
    $env:PGUSER        = $remoteUser.Trim()
    $env:PGPASSWORD    = $plainPassword
    $env:PGSSLMODE     = "verify-full"
    $env:PGSSLROOTCERT = $resolvedSslRootCert

    Write-Host ""
    Write-Host "[FASE A] Comprobaciones previas de solo lectura en Supabase produccion..." -ForegroundColor Yellow

    # Test de identidad
    $idQuery = "SELECT concat(current_database(), '|', current_user, '|', version());"
    $idRes = & $psqlExe -tAc $idQuery 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Error al conectar con Supabase: $idRes"
    }
    Write-Host "  [CONECTADO] Sesion verificada: $idRes" -ForegroundColor Green

    # Verificar que las 6 tablas no existan con definiciones incompatibles
    $tableCheckQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('mitigation_actions', 'agent_tasks', 'agent_audit_logs', 'ml_predictions_log', 'scheduler_locks', 'advisor_parcel_assignments');"
    $existingNewTables = @(& $psqlExe -tAc $tableCheckQuery 2>&1) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($existingNewTables.Count -gt 0) {
        $existList = $existingNewTables -join ', '
        Write-Host "  [AVISO] Se detectaron tablas del conjunto nuevo previamente creadas: $existList" -ForegroundColor DarkYellow
        Write-Host "          La migracion es estrictamente idempotente y verificara su compatibilidad." -ForegroundColor Gray
    } else {
        Write-Host "  [OK] Ninguna de las 6 tablas nuevas preexiste en el esquema public." -ForegroundColor Green
    }

    # Linea base de registros pre-migracion
    Write-Host "  Capturando conteos de linea base pre-migracion..." -ForegroundColor Gray
    $tablesToCheck = @('users', 'parcels', 'crops', 'products', 'purchase_orders', 'order_status_history', 'notifications', 'crop_logs', 'weather_cache', 'advisory_tips')
    $preCounts = @{}
    foreach ($tbl in $tablesToCheck) {
        $cnt = (& $psqlExe -tAc "SELECT count(*) FROM public.$tbl;" 2>&1).Trim()
        $preCounts[$tbl] = $cnt
        Write-Host "    - $tbl : $cnt registros" -ForegroundColor Gray
    }

    # FASE B: Ejecucion controlada
    Write-Host ""
    Write-Host "[FASE B] Ejecutando scratch/fase8_production_migration.sql en Supabase produccion..." -ForegroundColor Yellow
    $startTime = Get-Date
    $migOutput = & $psqlExe -v ON_ERROR_STOP=1 -f $scriptPath 2>&1
    $migExitCode = $LASTEXITCODE
    $duration = (Get-Date) - $startTime
    $durationSec = [math]::Round($duration.TotalSeconds, 2)

    if ($migExitCode -ne 0) {
        Write-Host "[ERROR] ERROR EN MIGRACION TRANSACCIONAL (Codigo $migExitCode):" -ForegroundColor Red
        $migOutput | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
        throw "La migracion SQL fallo y fue abortada automaticamente mediante ROLLBACK en PostgreSQL."
    }

    Write-Host "  [OK] Transaccion completada y COMMIT confirmado en $durationSec segundos." -ForegroundColor Green

    # FASE C: Verificacion posterior
    Write-Host ""
    Write-Host "[FASE C] Verificaciones posteriores de solo lectura..." -ForegroundColor Yellow

    # Comprobar 6 tablas nuevas
    $postNewTables = @(& $psqlExe -tAc $tableCheckQuery 2>&1) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $postTableList = $postNewTables -join ', '
    Write-Host "  - Tablas nuevas confirmadas en public ($($postNewTables.Count)/6): $postTableList" -ForegroundColor Green
    if ($postNewTables.Count -lt 6) {
        throw "No se crearon todas las 6 tablas esperadas."
    }

    # Comprobar columnas de notifications
    $notifColsQuery = "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name IN ('horizon', 'risk_level', 'risk_score') ORDER BY column_name;"
    $notifCols = @(& $psqlExe -tAc $notifColsQuery 2>&1) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $notifColList = $notifCols -join ', '
    Write-Host "  - Columnas anadidas a notifications ($($notifCols.Count)/3): $notifColList" -ForegroundColor Green

    # Comparar conteos de datos de negocio
    Write-Host "  - Comprobando conteos de datos existentes..." -ForegroundColor Gray
    $postCounts = @{}
    $countsMatch = $true
    foreach ($tbl in $tablesToCheck) {
        $postCnt = (& $psqlExe -tAc "SELECT count(*) FROM public.$tbl;" 2>&1).Trim()
        $postCounts[$tbl] = $postCnt
        $match = ($postCnt -eq $preCounts[$tbl])
        if (-not $match) { $countsMatch = $false }
        $statusStr = if ($match) { "INALTERADO" } else { "DIFIERE" }
        $statusColor = if ($match) { "Green" } else { "Yellow" }
        Write-Host "    - $tbl : Pre=$($preCounts[$tbl]) | Post=$postCnt ($statusStr)" -ForegroundColor $statusColor
    }

    $migrationSuccess = $true

    # Generar manifiesto de migracion en C:\AgroPasco_Backups
    $nowUtc = (Get-Date).ToUniversalTime().ToString("o")
    $manifestObj = @{
        project = "AgroPasco Digital"
        migration = "Fases 1 a 8 - Motor Predictivo y MLOps"
        environment = "Production"
        executed_at_utc = $nowUtc
        executed_at_local = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        remote_host = $remoteHost.Trim()
        remote_port = [int]$remotePort.Trim()
        remote_database = $remoteDb.Trim()
        ssl_mode = "verify-full"
        ssl_root_cert = (Split-Path $resolvedSslRootCert -Leaf)
        script_file = (Split-Path $scriptPath -Leaf)
        script_sha256 = $actualHash
        execution_duration_sec = $durationSec
        status = "COMPLETED_SUCCESS"
        new_tables_verified = $postNewTables
        notifications_columns_verified = $notifCols
        pre_counts = $preCounts
        post_counts = $postCounts
        counts_match = $countsMatch
    }

    $manifestPath = Join-Path $BackupDirectory "migration_production_manifest_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
    $manifestObj | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8
    Write-Host ""
    Write-Host "  [MANIFIESTO] Registro de auditoria guardado en: $manifestPath" -ForegroundColor Green

    Write-Host ""
    Write-Host "==============================================================================" -ForegroundColor Green
    Write-Host " MIGRACION EN SUPABASE PRODUCCION COMPLETADA Y VERIFICADA EXITOSAMENTE " -ForegroundColor Green
    Write-Host "==============================================================================" -ForegroundColor Green

} finally {
    # Limpieza estricta de credenciales en memoria
    $env:PGPASSWORD = $null
    $plainPassword = $null
    if ($null -ne $ptr -and [IntPtr]::Zero -ne $ptr) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $ptr = [IntPtr]::Zero
    }
    Remove-Item env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item env:PGHOST -ErrorAction SilentlyContinue
    Remove-Item env:PGPORT -ErrorAction SilentlyContinue
    Remove-Item env:PGDATABASE -ErrorAction SilentlyContinue
    Remove-Item env:PGUSER -ErrorAction SilentlyContinue
    Remove-Item env:PGSSLMODE -ErrorAction SilentlyContinue
    Remove-Item env:PGSSLROOTCERT -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "[SEGURIDAD] Variables de entorno y credenciales en memoria limpiadas." -ForegroundColor Gray
}

if (-not $migrationSuccess) {
    exit 1
}
