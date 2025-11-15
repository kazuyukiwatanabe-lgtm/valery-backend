# valery-backend (Cloud Run / Node 20)


## 0. 前提
- Windows (PowerShell)
- Google Cloud SDK (gcloud) インストール済み
- プロジェクト: avatar-chat-test-001（例）
- リージョン: asia-northeast1（東京）


## 1. 初期セットアップ
```powershell
# 任意の場所で
PS> mkdir valery-backend; cd valery-backend


# 上記テンプレのファイルを配置


# 依存インストール
PS valery-backend> npm install


# ローカル起動
PS valery-backend> $env:PORT=8080; npm start
# 確認
PS> Invoke-WebRequest http://localhost:8080/ | Select-Object -ExpandProperty Content
PS> Invoke-WebRequest http://localhost:8080/healthz | Select -Expand Content