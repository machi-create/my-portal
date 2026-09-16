<#
  Tab Diet を Windows のフォルダに配置するスクリプト

  使い方:
    1) PowerShell を開く
    2) このファイルの中身を貼り付けて実行する
       （またはファイルを置いた場所で  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 ）

  別の場所に入れたい場合:
    .\install-windows.ps1 -Destination "D:\tools"
#>

param(
  [string]$Destination = 'C:\Users\user\OneDrive\Desktop\Claude\Business improvement'
)

$ErrorActionPreference = 'Stop'

$zipUrl = 'https://github.com/machi-create/my-portal/archive/refs/heads/claude/chrome-memory-extension-g0gn9d.zip'
$inner  = 'my-portal-claude-chrome-memory-extension-g0gn9d\extension\tab-diet'
$work   = Join-Path $env:TEMP 'tab-diet-setup'
$target = Join-Path $Destination 'tab-diet'

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Write-Host 'GitHub からダウンロード中...'
$zipPath = Join-Path $work 'branch.zip'
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

Write-Host '展開中...'
Expand-Archive -Path $zipPath -DestinationPath $work -Force

$source = Join-Path $work $inner
if (-not (Test-Path $source)) { throw "展開結果に tab-diet が見つかりません: $source" }

if (Test-Path $target) {
  Write-Host '既存の tab-diet フォルダを新しい内容で置き換えます'
  Remove-Item $target -Recurse -Force
}
Copy-Item -Path $source -Destination $target -Recurse -Force
Remove-Item $work -Recurse -Force

# OneDrive がクラウドのみの状態にすると Chrome が読み込めないため、実体をPCに保持する
# （エクスプローラの「このデバイス上で常に保持する」と同じ設定）
cmd /c "attrib +P -U `"$target\*`" /S /D" 2>&1 | Out-Null

Write-Host ''
Write-Host "配置しました: $target"
Write-Host ''
Write-Host '次の手順で Chrome に読み込みます:'
Write-Host '  1. chrome://extensions を開く'
Write-Host '  2. 右上の「デベロッパーモード」をオンにする'
Write-Host '  3.「パッケージ化されていない拡張機能を読み込む」をクリック'
Write-Host "  4. $target を選択"
Write-Host ''
Write-Host 'サイドパネルは ツールバーのアイコン または Alt+Shift+T で開きます'

Invoke-Item $Destination
