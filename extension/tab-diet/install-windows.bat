@echo off
title Tab Diet セットアップ
echo.
echo   Tab Diet を最新版に更新しています。しばらくお待ちください...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $dest=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude\Business improvement'; $url='https://github.com/machi-create/my-portal/archive/refs/heads/claude/chrome-memory-extension-g0gn9d.zip'; $work=Join-Path $env:TEMP 'tab-diet-setup'; $target=Join-Path $dest 'tab-diet'; if (Test-Path $work) { Remove-Item $work -Recurse -Force }; $null=New-Item -ItemType Directory -Force -Path $work; $null=New-Item -ItemType Directory -Force -Path $dest; $zip=Join-Path $work 'src.zip'; Invoke-WebRequest -Uri $url -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $work -Force; $src=Join-Path $work 'my-portal-claude-chrome-memory-extension-g0gn9d\extension\tab-diet'; if (Test-Path $target) { Remove-Item $target -Recurse -Force }; Copy-Item -Path $src -Destination $target -Recurse -Force; Remove-Item $work -Recurse -Force; $ErrorActionPreference='Continue'; attrib +P -U ($target + '\*') /S /D; Write-Host ('  配置しました: ' + $target) -ForegroundColor Green; Invoke-Item $dest"
echo.
echo   ---------------------------------------------------------------
echo   はじめて入れる場合:
echo     1. Chrome で chrome://extensions を開く
echo     2. 右上の「デベロッパーモード」をオンにする
echo     3.「パッケージ化されていない拡張機能を読み込む」をクリック
echo     4. 開いたフォルダの中の tab-diet を選ぶ
echo.
echo   すでに入れている場合:
echo     chrome://extensions を開き、Tab Diet の更新ボタンを押すだけです。
echo   ---------------------------------------------------------------
echo.
pause
