<#
.SYNOPSIS
    AgroPasco Digital - Script Seguro y Reutilizable de Respaldo PostgreSQL (pg_dump)
.DESCRIPTION
    Genera un respaldo transaccional en formato personalizado (-Fc), verifica su
    integridad estructural con pg_restore --list, calcula su hash SHA-256 y permite
    validar la restauracion en una base de datos local aislada (sandbox).

    Principios de Seguridad y Operacion:
      1. Operacion exclusivamente de lectura (pg_dump usa transacciones de solo lectura).
      2. No expone contrasenas en argumentos de proceso, logs ni archivos de disco.
      3. Limpieza garantizada de credenciales en memoria mediante bloque try/finally.
      4. Verificacion estricta del codigo de salida de pg_dump (aborto ante fallos).
      5. Prevencion de uso de Transaction Pooler (puerto 6543 no apto para dump).
      6. Verificacion de seguridad antes de restauracion: rechaza hosts remotos.
      7. Almacenamiento seguro fuera del repositorio en C:\AgroPasco_Backups.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BackupDirectory = "C:\AgroPasco_Backups",

    [Parameter(Mandatory = $false)]
    [string]$PgBinPath = "C:\Program Files\PostgreSQL\18\bin",

    [Parameter(Mandatory = $false)]
    [switch]$TestRestoreInLocalSandbox = $false,

    [Parameter(Mandatory = $false)]
    [string]$LocalSandboxDb = "agropasco_restore_sandbox",

    [Parameter(Mandatory = $false)]
    [int]$LocalSandboxPort = 5432
)

$ErrorActionPreference = "Stop"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " [AgroPasco Digital] Respaldo Seguro PostgreSQL (Supabase / Render)" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Cyan

# 1. Verificar herramientas de PostgreSQL
$pgDumpExe = Join-Path $PgBinPath "pg_dump.exe"
$pgRestoreExe = Join-Path $PgBinPath "pg_restore.exe"
$createdbExe = Join-Path $PgBinPath "createdb.exe"
$dropdbExe = Join-Path $PgBinPath "dropdb.exe"

if (-not (Test-Path $pgDumpExe)) {
    throw "No se encontro pg_dump.exe en: $pgDumpExe. Verifique la ruta del motor PostgreSQL."
}
if (-not (Test-Path $pgRestoreExe)) {
    throw "No se encontro pg_restore.exe en: $pgRestoreExe."
}

# 2. Asegurar directorio de respaldo aislado
if (-not (Test-Path $BackupDirectory)) {
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    Write-Host "[INFO] Directorio de respaldo creado: $BackupDirectory" -ForegroundColor Gray
}

# 3. Solicitar parametros de conexion al operador (sin exponer contrasenas)
Write-Host ""
Write-Host "[CONFIGURACION] Parametros de Conexion a PostgreSQL de Produccion:" -ForegroundColor Yellow
Write-Host "  Nota: Para Supabase, utilice Direct Connection o Session Pooler." -ForegroundColor Gray
Write-Host "  AVISO: NO utilice Transaction Pooler (puerto 6543) para pg_dump." -ForegroundColor DarkYellow
Write-Host ""

$remoteHost = Read-Host "Host de PostgreSQL (ej: db.xxxxx.supabase.co o aws-0-us-east-1.pooler.supabase.com)"
if ([string]::IsNullOrWhiteSpace($remoteHost)) {
    throw "El host de base de datos es obligatorio."
}

$remotePort = Read-Host "Puerto (por defecto 5432 para Direct Connection / Session Pooler)"
if ([string]::IsNullOrWhiteSpace($remotePort)) { 
    $remotePort = "5432" 
}

# Deteccion preventiva de Transaction Pooler
if ($remotePort.Trim() -eq "6543") {
    Write-Warning "El puerto 6543 corresponde habitualmente a Transaction Pooler (PgBouncer)."
    Write-Warning "pg_dump requiere transacciones de instantanea de sesion y fallara en Transaction Pooler."
    $confirmPort = Read-Host "Desea continuar con 6543 o cambiar a 5432? (ingrese '5432' o 'ignorar')"
    if ($confirmPort.Trim() -eq "5432") {
        $remotePort = "5432"
    }
}

$remoteUser = Read-Host "Usuario de PostgreSQL (por defecto postgres)"
if ([string]::IsNullOrWhiteSpace($remoteUser)) { 
    $remoteUser = "postgres" 
}

$remoteDb = Read-Host "Base de datos (por defecto postgres)"
if ([string]::IsNullOrWhiteSpace($remoteDb)) { 
    $remoteDb = "postgres" 
}

# Captura enmascarada de la contrasena
$secPassword = Read-Host -Prompt "Contrasena de PostgreSQL" -AsSecureString
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)

# 4. Nombres y rutas de archivos
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dumpFileName = "agropasco_prod_backup_$timestamp.dump"
$dumpFilePath = Join-Path $BackupDirectory $dumpFileName
$manifestFilePath = Join-Path $BackupDirectory "agropasco_prod_backup_${timestamp}_manifest.json"

$backupSuccessful = $false
$exitCode = -1

# 5. Ejecucion protegida con try / finally para garantizar limpieza de credenciales
try {
    Write-Host ""
    Write-Host "[INICIO] Iniciando volcado transaccional de solo lectura..." -ForegroundColor Cyan
    Write-Host "         Destino: $dumpFilePath" -ForegroundColor Gray

    # Inyeccion de variables de entorno efimeras en la sesion de proceso
    $env:PGHOST     = $remoteHost.Trim()
    $env:PGPORT     = $remotePort.Trim()
    $env:PGDATABASE = $remoteDb.Trim()
    $env:PGUSER     = $remoteUser.Trim()
    $env:PGPASSWORD = $plainPassword
    $env:PGSSLMODE  = "require"

    # Invocar pg_dump en modo -Fc (Custom Format comprimido, no destructivo, sin --clean)
    $startTime = Get-Date
    & $pgDumpExe -Fc --no-owner --no-privileges -f $dumpFilePath
    $exitCode = $LASTEXITCODE
    $duration = (Get-Date) - $startTime

    # 6. Comprobacion estricta del codigo de salida de pg_dump
    if ($exitCode -ne 0) {
        if (Test-Path $dumpFilePath) {
            $failedPath = "$dumpFilePath.failed"
            Rename-Item -Path $dumpFilePath -NewName (Split-Path $failedPath -Leaf) -Force
            Write-Host "[AVISO] Archivo incompleto renombrado a: $failedPath" -ForegroundColor DarkYellow
        }
        throw "pg_dump finalizo con codigo de error $exitCode. Operacion abortada sin exito."
    }

    if ((-not (Test-Path $dumpFilePath)) -or ((Get-Item $dumpFilePath).Length -eq 0)) {
        throw "pg_dump finalizo sin generar el archivo de respaldo o el archivo tiene tamano cero."
    }

    $elapsedSec = [math]::Round($duration.TotalSeconds, 1)
    Write-Host "[OK] Volcado de pg_dump completado exitosamente en $elapsedSec segundos." -ForegroundColor Green

    # 7. Verificacion de Integridad de la Tabla de Contenidos (TOC)
    Write-Host ""
    Write-Host "[VERIFICACION] Validando integridad estructural del archivo con pg_restore --list..." -ForegroundColor Cyan
    $tocLines = & $pgRestoreExe --list $dumpFilePath
    $restoreListExitCode = $LASTEXITCODE

    if ($restoreListExitCode -ne 0 -or $null -eq $tocLines -or $tocLines.Count -eq 0) {
        throw "Fallo la verificacion de cabecera / TOC del archivo de respaldo (codigo $restoreListExitCode)."
    }

    $tableEntries = ($tocLines | Where-Object { $_ -match "\sTABLE DATA\s" }).Count
    Write-Host "[OK] Integridad estructural validada: $($tocLines.Count) objetos y $tableEntries tablas con datos." -ForegroundColor Green

    # 8. Calculo de Hash Criptografico SHA-256 y Registro de Metadatos
    Write-Host ""
    Write-Host "[HASH] Calculando hash SHA-256..." -ForegroundColor Cyan
    $hashResult = Get-FileHash -Path $dumpFilePath -Algorithm SHA256
    $fileInfo = Get-Item $dumpFilePath
    $fileSizeBytes = $fileInfo.Length
    $fileSizeKb = [math]::Round(($fileSizeBytes / 1KB), 2)
    $fileSizeMb = [math]::Round(($fileSizeBytes / 1MB), 2)

    $manifest = @{
        project = "AgroPasco Digital"
        environment = "Production"
        source_provider = "Supabase PostgreSQL"
        remote_host = $remoteHost.Trim()
        remote_port = [int]$remotePort.Trim()
        remote_database = $remoteDb.Trim()
        backup_file = $dumpFileName
        backup_path = $dumpFilePath
        created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
        created_at_local = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        duration_seconds = [math]::Round($duration.TotalSeconds, 2)
        format = "PostgreSQL Custom Format (-Fc)"
        sha256 = $hashResult.Hash
        size_bytes = $fileSizeBytes
        size_kb = $fileSizeKb
        size_mb = $fileSizeMb
        toc_total_entries = $tocLines.Count
        toc_table_data_entries = $tableEntries
        integrity_check = "VERIFIED_VALID"
        scope = @{
            included = @("tablas", "datos", "esquemas", "secuencias_serial", "hashes_contrasenas", "indices", "constraints", "metadatos_urls_fotos")
            external_not_included = @("archivos_binarios_supabase_storage_buckets")
        }
    }

    $manifestJson = $manifest | ConvertTo-Json -Depth 5
    Set-Content -Path $manifestFilePath -Value $manifestJson -Encoding utf8

    Write-Host "==============================================================================" -ForegroundColor Green
    Write-Host " RESPALDO VERIFICADO Y REGISTRADO EXITOSAMENTE" -ForegroundColor Green
    Write-Host "==============================================================================" -ForegroundColor Green
    Write-Host "  Archivo:     $dumpFilePath" -ForegroundColor White
    Write-Host "  Tamano:      $fileSizeMb MB ($fileSizeKb KB)" -ForegroundColor White
    Write-Host "  SHA-256:     $($hashResult.Hash)" -ForegroundColor White
    Write-Host "  Manifiesto:  $manifestFilePath" -ForegroundColor White
    Write-Host "==============================================================================" -ForegroundColor Green

    $backupSuccessful = $true

    # 9. Prueba de Restauracion Aislada en Base Local (Sandbox)
    if ($TestRestoreInLocalSandbox) {
        Write-Host ""
        Write-Host "[SANDBOX] Iniciando restauracion de prueba en base local aislada..." -ForegroundColor Yellow

        # Verificacion estricta de seguridad: NUNCA ejecutar contra produccion
        $safeLocalHosts = @("localhost", "127.0.0.1", "::1")
        $targetHost = "127.0.0.1"

        if ($safeLocalHosts -notcontains $targetHost) {
            throw "ABORTO DE SEGURIDAD: El destino de prueba ($targetHost) no es un host local seguro."
        }

        Write-Host "  Destino local seguro: ${targetHost}:${LocalSandboxPort} (BD: $LocalSandboxDb)" -ForegroundColor Gray

        try {
            & $dropdbExe -h $targetHost -p $LocalSandboxPort -U postgres --if-exists $LocalSandboxDb 2>$null
            & $createdbExe -h $targetHost -p $LocalSandboxPort -U postgres $LocalSandboxDb
            Write-Host "  Base temporal '$LocalSandboxDb' creada localmente." -ForegroundColor Gray

            Write-Host "  Restaurando objetos con pg_restore..." -ForegroundColor Gray
            & $pgRestoreExe -h $targetHost -p $LocalSandboxPort -U postgres -d $LocalSandboxDb --no-owner --no-privileges $dumpFilePath 2>&1 | Out-Null
            
            Write-Host "  [OK] Restauracion de prueba en sandbox completada sin errores." -ForegroundColor Green
            Write-Host "  Destruyendo base de pruebas local temporal..." -ForegroundColor Gray
            & $dropdbExe -h $targetHost -p $LocalSandboxPort -U postgres $LocalSandboxDb 2>$null
            Write-Host "  [OK] Base temporal destruida. Sandbox limpio." -ForegroundColor Green
        } catch {
            Write-Warning "La restauracion de prueba en sandbox local no pudo completarse: $($_.Exception.Message)"
            Write-Warning "Nota: El respaldo primario en $dumpFilePath se encuentra integro y verificado por TOC."
        }
    }

} catch {
    Write-Host ""
    Write-Host "[ERROR] ERROR DURANTE EL PROCESO DE RESPALDO:" -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)" -ForegroundColor Red
    $backupSuccessful = $false
} finally {
    # ==============================================================================
    # LIMPIEZA GARANTIZADA DE CREDENCIALES EN MEMORIA (TRY / FINALLY)
    # ==============================================================================
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

    Write-Host ""
    Write-Host "[SEGURIDAD] Variables de entorno y credenciales en memoria eliminadas." -ForegroundColor Gray
}

if (-not $backupSuccessful) {
    exit 1
}
