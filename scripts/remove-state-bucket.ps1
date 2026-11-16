# Run only after Terraform has successfully destroyed the project resources.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

$ErrorActionPreference = 'Stop'
$infraPath = (Resolve-Path (Join-Path $PSScriptRoot '../infra')).Path
$backendText = Get-Content -LiteralPath (Join-Path $infraPath 'backend.tf') -Raw

function Get-BackendValue([string]$Name) {
    $match = [regex]::Match($backendText, ('(?m)^\s*' + [regex]::Escape($Name) + '\s*=\s*"([^"]+)"'))
    if (-not $match.Success) { throw "Cannot read $Name from infra/backend.tf" }
    return $match.Groups[1].Value
}

$bucket = Get-BackendValue 'bucket'
$region = Get-BackendValue 'region'
$stateKey = Get-BackendValue 'key'
$metadataPath = Join-Path $infraPath '.terraform/terraform.tfstate'
if (-not (Test-Path -LiteralPath $metadataPath)) {
    throw 'Initialize the existing Terraform backend before running this script.'
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.backend.type -ne 's3' -or $metadata.backend.config.bucket -ne $bucket -or
    $metadata.backend.config.key -ne $stateKey -or $metadata.backend.config.region -ne $region) {
    throw 'Initialized backend does not match backend.tf. Refusing bucket deletion.'
}
$workspace = terraform "-chdir=$infraPath" workspace show
if ($LASTEXITCODE -ne 0 -or ($workspace -join '').Trim() -ne 'default') {
    throw 'This cleanup script supports only the default Terraform workspace.'
}

$account = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw 'AWS authentication failed.' }
aws s3api head-bucket --bucket $bucket --region $region --expected-bucket-owner $account
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify state bucket ownership.' }

$stateLines = terraform "-chdir=$infraPath" state pull
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Terraform state. Refusing bucket deletion.' }
$stateText = $stateLines -join "`n"
$state = $stateText | ConvertFrom-Json
if (@($state.resources | Where-Object { $null -ne $_ }).Count -gt 0) {
    throw 'Terraform still tracks resources. Complete terraform destroy before deleting the backend.'
}

$currentLines = aws s3api list-objects-v2 --bucket $bucket --region $region --expected-bucket-owner $account --output json
if ($LASTEXITCODE -ne 0) { throw 'Cannot check for an active state lock.' }
$current = ($currentLines -join "`n") | ConvertFrom-Json
if (@($current.Contents | Where-Object { $_.Key -eq "$stateKey.tflock" }).Count -gt 0) {
    throw 'An active Terraform lock exists. Refusing bucket deletion.'
}
# AWS CLI paginates this preflight automatically, including all historical keys.
$versionLines = aws s3api list-object-versions --bucket $bucket --region $region --expected-bucket-owner $account --output json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect historical state keys.' }
$versions = ($versionLines -join "`n") | ConvertFrom-Json
foreach ($entry in @(@($versions.Versions) + @($versions.DeleteMarkers) | Where-Object { $null -ne $_ })) {
    if ($entry.Key -notin @($stateKey, "$stateKey.tflock")) {
        throw "Unexpected object in state bucket: $($entry.Key). Refusing bucket deletion."
    }
}

if (-not $PSCmdlet.ShouldProcess($bucket, 'Permanently delete all state versions, delete markers, and the S3 bucket')) {
    return
}

$backupPath = Join-Path $infraPath 'teardown-backups'
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
$backupFile = Join-Path $backupPath ("empty-state-{0}.tfstate" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.File]::WriteAllText($backupFile, $stateText, [Text.UTF8Encoding]::new($false))

$deleteFile = [IO.Path]::GetTempFileName()
try {
    while ($true) {
        # Delete the first page, then list again. This handles more than 1,000 versions.
        $pageLines = aws s3api list-object-versions --bucket $bucket --region $region --expected-bucket-owner $account --max-keys 1000 --no-paginate --output json
        if ($LASTEXITCODE -ne 0) { throw 'Cannot list state object versions.' }
        $page = ($pageLines -join "`n") | ConvertFrom-Json
        $entries = @(@($page.Versions) + @($page.DeleteMarkers) | Where-Object { $null -ne $_ })
        if ($entries.Count -eq 0) { break }
        $objects = @()
        foreach ($entry in $entries) {
            if ($entry.Key -notin @($stateKey, "$stateKey.tflock")) {
                throw "Unexpected object in state bucket: $($entry.Key). Refusing to delete unrelated data."
            }
            $objects += @{ Key = $entry.Key; VersionId = $entry.VersionId }
        }
        $payload = @{ Objects = $objects; Quiet = $true } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText($deleteFile, $payload, [Text.UTF8Encoding]::new($false))
        $resultLines = aws s3api delete-objects --bucket $bucket --region $region --expected-bucket-owner $account --delete "file://$deleteFile" --output json
        if ($LASTEXITCODE -ne 0) { throw 'Deleting state versions failed.' }
        $result = ($resultLines -join "`n") | ConvertFrom-Json
        if (@($result.Errors | Where-Object { $null -ne $_ }).Count -gt 0) {
            throw 'S3 rejected one or more deletions. Bucket has not been deleted.'
        }
    }
    aws s3api delete-bucket --bucket $bucket --region $region --expected-bucket-owner $account
    if ($LASTEXITCODE -ne 0) { throw 'Deleting the empty state bucket failed.' }
    Write-Output "Deleted the versioned state bucket: $bucket"
    Write-Output "Final empty state backup: $backupFile"
}
finally {
    Remove-Item -LiteralPath $deleteFile -Force -ErrorAction SilentlyContinue
}
