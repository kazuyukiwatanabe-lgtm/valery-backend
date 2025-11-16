# Valery Backend

Google Cloud Run 上で動作する Valery のバックエンドサービスです。  
Vertex AI (Gemini) を使ったチャット API と、ヘルスチェック用エンドポイントを提供します。

---

## 📌 概要

- 言語: **Node.js + Express**
- デプロイ先: **Cloud Run**
- GCP プロジェクト: `avatar-chat-test-001`
- リージョン: `asia-northeast1`
- 主な機能:
  - `/chat` : Gemini 2.5 Flash によるチャット API
  - `/` : 動作確認用レスポンス
  - `/healthz` : （現状は未使用。生存確認は `/` を使用）
  - `/rag-chat` : RAG チャット（※現在は実験中・未完成）

---

## 📌 必要な環境変数

Cloud Run / ローカル（Cloud Shell）共通で利用。

| 変数名 | 内容 | 例 |
|--------|------|------|
| `VERTEX_LOCATION` | Vertex AI のリージョン | `asia-northeast1` |
| `CHAT_MODEL` | チャット用モデル | `gemini-2.5-flash` |
| `EMB_MODEL` | 埋め込みモデル（RAG用） | `text-embedding-004` |

Cloud Run のデプロイ時は、以下のように指定します。

```bash
--set-env-vars="VERTEX_LOCATION=asia-northeast1,CHAT_MODEL=gemini-2.5-flash,EMB_MODEL=text-embedding-004"
