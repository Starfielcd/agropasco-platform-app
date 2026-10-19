<#
.SYNOPSIS
    AgroPasco Digital - Script Seguro y Reutilizable de Respaldo PostgreSQL (pg_dump)
.DESCRIPTION
    Genera un respaldo transaccional en formato personalizado (-Fc), verifica su
    integridad estructural con pg_restore --list, calcula su hash SHA-256 y permite
    validar la restauracion en una base de datos local aislada (sandbox).

    Principios de Seguridad y Operacion:
      1. Operacion exclusivamente de lectura (pg_dump usa transacciones de solo lectura).
      2. No expone contrasenas en comandos visibles, argumentos de procesos, logs, manifiestos ni archivos persistentes.
      3. Limpieza de credenciales en memoria en condiciones normales mediante bloque try/finally.
         Nota de diseno: No se afirma ni garantiza eliminacion absoluta de credenciales en caso de que el
         proceso o la terminal finalicen de forma abrupta (e.g. cierre forzado, crash o suspension del SO).
      4. Verificacion estricta del codigo de salida de cada comando (pg_dump, pg_restore, herramientas de sandbox).
      5. Prevencion total de sobrescritura de respaldos preexistentes o manifiestos.
      6. Verificacion TLS estricta y obligatoria (sslmode=verify-full) con certificado CA valido; no se desactiva ante errores.
      7. Deteccion preventiva contra el uso de Transaction Pooler (puerto 6543 no apto para dump).
      8. Verificacion de seguridad antes de restauracion sandbox: rechaza hosts no locales.
      9. Almacenamiento seguro fuera del repositorio en C:\AgroPasco_Backups.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BackupDirectory = "C:\AgroPasco_Backups",

    [Parameter(Mandatory = $false)]
    [string]$PgBinPath = "C:\Program Files\PostgreSQL\18\bin",

    [Parameter(Mandatory = $false)]
    [string]$SslRootCert = "",

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
$psqlExe = Join-Path $PgBinPath "psql.exe"

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

# 3. Validacion y Resolucion de Certificado CA para TLS (sslmode=verify-full obligatorio)
# Comprueba rutas estandar si no se envio por parametro
if ([string]::IsNullOrWhiteSpace($SslRootCert)) {
    $candidatePaths = @(
        (Join-Path $BackupDirectory "prod-ca-2021.crt"),
        (Join-Path $BackupDirectory "root.crt"),
        (Join-Path $env:APPDATA "postgresql\root.crt"),
        (Join-Path $PSScriptRoot "..\certs\prod-ca-2021.crt")
    )
    foreach ($cand in $candidatePaths) {
        if (Test-Path $cand) {
            $SslRootCert = (Resolve-Path $cand).Path
            Write-Host "[INFO] Certificado CA detectado automaticamente: $SslRootCert" -ForegroundColor Gray
            break
        }
    }
}

# Si sigue vacio, solicitar interactivamente la ruta del certificado CA
if ([string]::IsNullOrWhiteSpace($SslRootCert)) {
    Write-Host ""
    Write-Host "[SEGURIDAD TLS] 'sslmode=verify-full' es obligatorio. Se requiere el certificado CA raiz de Supabase." -ForegroundColor Yellow
    Write-Host "                 (Ejemplo: C:\AgroPasco_Backups\prod-ca-2021.crt o %APPDATA%\postgresql\root.crt)" -ForegroundColor Gray
    $promptCert = Read-Host "Ruta al archivo de certificado CA de Supabase (.crt / .pem)"
    if (-not [string]::IsNullOrWhiteSpace($promptCert)) {
        $SslRootCert = $promptCert.Trim().Trim('"')
    }
}

# Verificacion estricta: No se permite continuar ni degradar si el certificado no existe
if ([string]::IsNullOrWhiteSpace($SslRootCert) -or (-not (Test-Path $SslRootCert))) {
    throw "ABORTO DE SEGURIDAD TLS: No se especifico o no existe el certificado CA en '$SslRootCert'. Con 'sslmode=verify-full' es obligatorio contar con el certificado CA valido de Supabase. La verificacion TLS NO se desactivara."
}

$resolvedSslRootCert = (Resolve-Path $SslRootCert).Path

# 4. Solicitar parametros de conexion al operador (sin exponer contrasenas)
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

# Captura enmascarada de la contrasena (no visible en consola)
$secPassword = Read-Host -Prompt "Contrasena de PostgreSQL" -AsSecureString
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)

# 5. Generacion de nombres y proteccion estricta contra sobrescritura
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dumpFileName = "agropasco_prod_backup_$timestamp.dump"
$dumpFilePath = Join-Path $BackupDirectory $dumpFileName
$manifestFilePath = Join-Path $BackupDirectory "agropasco_prod_backup_${timestamp}_manifest.json"

if (Test-Path $dumpFilePath) {
    throw "ABORTO DE SEGURIDAD: El archivo de respaldo '$dumpFilePath' ya existe. Para proteger respaldos anteriores, no se sobrescribira."
}
if (Test-Path $manifestFilePath) {
    throw "ABORTO DE SEGURIDAD: El manifiesto '$manifestFilePath' ya existe. No se sobrescribira."
}

$backupSuccessful = $false
$exitCode = -1

# 6. Ejecucion protegida con try / finally para limpieza preventiva de credenciales
# (Sujeto a ejecucion controlada del proceso de PowerShell; ver descripcion)
try {
    Write-Host ""
    Write-Host "[INICIO] Iniciando volcado transaccional de solo lectura..." -ForegroundColor Cyan
    Write-Host "         Destino: $dumpFilePath" -ForegroundColor Gray

    # Configuracion de variables de entorno efimeras en la sesion del proceso
    $env:PGHOST         = $remoteHost.Trim()
    $env:PGPORT         = $remotePort.Trim()
    $env:PGDATABASE     = $remoteDb.Trim()
    $env:PGUSER         = $remoteUser.Trim()
    $env:PGPASSWORD     = $plainPassword
    $env:PGSSLMODE      = "verify-full"
    $env:PGSSLROOTCERT  = $resolvedSslRootCert

    Write-Host "         Modo TLS: verify-full (Verificacion estricta de CA y hostname)" -ForegroundColor Green
    Write-Host "         Certificado CA: $env:PGSSLROOTCERT" -ForegroundColor Gray

    # Invocar pg_dump en modo -Fc (Custom Format comprimido, no destructivo, sin credenciales en argumentos)
    $startTime = Get-Date
    & $pgDumpExe -Fc --no-owner --no-privileges -f $dumpFilePath
    $exitCode = $LASTEXITCODE
    $duration = (Get-Date) - $startTime

    # Limpieza inmediata de la contrasena tras la finalizacion de pg_dump
    $env:PGPASSWORD = $null
    $plainPassword = $null
    if ($null -ne $ptr -and [IntPtr]::Zero -ne $ptr) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $ptr = [IntPtr]::Zero
    }
    Remove-Item env:PGPASSWORD -ErrorAction SilentlyContinue

    # 7. Comprobacion estricta del codigo de salida de pg_dump
    if ($exitCode -ne 0) {
        if (Test-Path $dumpFilePath) {
            $failedBase = "$dumpFilePath.failed"
            $failedPath = $failedBase
            $failIdx = 1
            while (Test-Path $failedPath) {
                $failedPath = "${failedBase}_${failIdx}"
                $failIdx++
            }
            Rename-Item -Path $dumpFilePath -NewName (Split-Path $failedPath -Leaf) -Force
            Write-Host "[AVISO] Archivo incompleto preservado como: $failedPath" -ForegroundColor DarkYellow
        }
        throw "pg_dump finalizo con codigo de error $exitCode. Operacion abortada sin exito."
    }

    if ((-not (Test-Path $dumpFilePath)) -or ((Get-Item $dumpFilePath).Length -eq 0)) {
        throw "pg_dump finalizo sin generar el archivo de respaldo o el archivo tiene tamano cero."
    }

    $elapsedSec = [math]::Round($duration.TotalSeconds, 1)
    Write-Host "[OK] Volcado de pg_dump completado exitosamente en $elapsedSec segundos." -ForegroundColor Green

    # 8. Verificacion de Integridad de la Tabla de Contenidos (TOC)
    Write-Host ""
    Write-Host "[VERIFICACION] Validando integridad estructural del archivo con pg_restore --list..." -ForegroundColor Cyan
    $tocLines = & $pgRestoreExe --list $dumpFilePath
    $restoreListExitCode = $LASTEXITCODE

    if ($restoreListExitCode -ne 0 -or $null -eq $tocLines -or $tocLines.Count -eq 0) {
        throw "Fallo la verificacion de cabecera / TOC del archivo de respaldo (codigo $restoreListExitCode)."
    }

    $tableEntries = ($tocLines | Where-Object { $_ -match "\sTABLE DATA\s" }).Count
    Write-Host "[OK] Integridad estructural validada: $($tocLines.Count) objetos y $tableEntries tablas con datos." -ForegroundColor Green

    # 9. Calculo de Hash Criptografico SHA-256 y Registro de Metadatos
    Write-Host ""
    Write-Host "[HASH] Calculando hash SHA-256..." -ForegroundColor Cyan
    $hashResult = Get-FileHash -Path $dumpFilePath -Algorithm SHA256
    $fileInfo = Get-Item $dumpFilePath
    $fileSizeBytes = $fileInfo.Length
    $fileSizeKb = [math]::Round(($fileSizeBytes / 1KB), 2)
    $fileSizeMb = [math]::Round(($fileSizeBytes / 1MB), 2)

    # Manifiesto sin datos sensibles ni contrasenas
    $manifest = @{
        project = "AgroPasco Digital"
        environment = "Production"
        source_provider = "Supabase PostgreSQL"
        remote_host = $remoteHost.Trim()
        remote_port = [int]$remotePort.Trim()
        remote_database = $remoteDb.Trim()
        ssl_mode = "verify-full"
        ssl_root_cert_file = (Split-Path $resolvedSslRootCert -Leaf)
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

    # 10. Prueba Opcional de Restauracion Aislada en Base Local (Sandbox)
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

        $sandboxStatus = "FAILED"

        try {
            # CONDICION OBLIGATORIA: Verificar si la base ya existe antes de crearla
            Write-Host "  Verificando que '$LocalSandboxDb' no exista previamente..." -ForegroundColor Gray
            $dbExists = & $psqlExe -h $targetHost -p $LocalSandboxPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$LocalSandboxDb'" 2>$null
            $dbCheckExitCode = $LASTEXITCODE

            if ($null -ne $dbExists -and $dbExists.Trim() -eq "1") {
                throw "ABORTO DE SEGURIDAD: La base de datos '$LocalSandboxDb' ya existe en PostgreSQL local. Por directiva de proteccion, NO se sobrescribira ni eliminara. Proceso detenido."
            }

            # Crear base sandbox
            & $createdbExe -h $targetHost -p $LocalSandboxPort -U postgres $LocalSandboxDb
            $createdbExitCode = $LASTEXITCODE
            if ($createdbExitCode -ne 0) {
                throw "createdb finalizo con codigo de error $createdbExitCode al inicializar la base sandbox."
            }
            Write-Host "  Base temporal '$LocalSandboxDb' creada localmente sin conflictos." -ForegroundColor Gray

            # Ejecutar restauracion
            Write-Host "  Restaurando objetos con pg_restore..." -ForegroundColor Gray
            & $pgRestoreExe -h $targetHost -p $LocalSandboxPort -U postgres -d $LocalSandboxDb --no-owner --no-privileges $dumpFilePath
            $restoreExitCode = $LASTEXITCODE

            if ($restoreExitCode -ne 0) {
                throw "pg_restore finalizo con codigo de error $restoreExitCode en el sandbox local."
            }

            # Verificar tablas y registros recuperados
            Write-Host "  Comprobando tablas y registros restaurados en sandbox..." -ForegroundColor Gray
            $tablesCount = & $psqlExe -h $targetHost -p $LocalSandboxPort -U postgres -d $LocalSandboxDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
            $usersCount = & $psqlExe -h $targetHost -p $LocalSandboxPort -U postgres -d $LocalSandboxDb -tAc "SELECT count(*) FROM users" 2>$null

            Write-Host "  [OK] Tablas restauradas: $tablesCount | Usuarios verificados: $usersCount" -ForegroundColor Green
            Write-Host "  [OK] Restauracion de prueba completada exitosamente y sin errores." -ForegroundColor Green
            $sandboxStatus = "SUCCESSFUL_VERIFIED"

            # Limpiar base sandbox de prueba
            Write-Host "  Destruyendo base de pruebas local temporal..." -ForegroundColor Gray
            & $dropdbExe -h $targetHost -p $LocalSandboxPort -U postgres $LocalSandboxDb 2>$null
            $dropExitCode = $LASTEXITCODE
            if ($dropExitCode -ne 0) {
                Write-Warning "dropdb retorno codigo $dropExitCode al intentar eliminar la base sandbox '$LocalSandboxDb'."
            } else {
                Write-Host "  [OK] Base temporal destruida. Sandbox limpio." -ForegroundColor Green
            }
        } catch {
            Write-Warning "La restauracion de prueba en sandbox local no pudo completarse: $($_.Exception.Message)"
            Write-Warning "El respaldo en $dumpFilePath mantiene su estado verificado por TOC y hash SHA-256."
            $sandboxStatus = "FAILED_OR_SKIPPED: $($_.Exception.Message)"
        }

        # Actualizar manifiesto con el resultado del sandbox
        $manifest.sandbox_test = @{
            status = $sandboxStatus
            tested_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            target_host = $targetHost
            target_port = $LocalSandboxPort
        }
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestFilePath -Encoding utf8
    }

} catch {
    Write-Host ""
    Write-Host "[ERROR] ERROR DURANTE EL PROCESO DE RESPALDO:" -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)" -ForegroundColor Red
    $backupSuccessful = $false
} finally {
    # ==============================================================================
    # LIMPIEZA DE CREDENCIALES EN MEMORIA (TRY / FINALLY - MEJOR ESFUERZO)
    # Nota de seguridad: Este bloque se ejecuta en el flujo normal o excepciones
    # capturadas por PowerShell. Si el proceso es destruido o termina de forma abrupta
    # a nivel de SO (SIGKILL / fallo de hardware / crash), la limpieza de memoria del
    # proceso depende exclusivamente del sistema operativo y no puede garantizarse
    # por el script.
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
    Remove-Item env:PGSSLROOTCERT -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "[SEGURIDAD] Variables de entorno y credenciales en memoria limpiadas (sesion controlada)." -ForegroundColor Gray
}

if (-not $backupSuccessful) {
    exit 1
}
