# Valery Backend (Vertex AI + RAG Chat API)

Valery のバックエンド API です。  
Google Cloud（Vertex AI + Firestore + Cloud Run）を利用し、  
**RAG（Retrieval-Augmented Generation）付きの /chat API** を提供します。

主な機能：

- Gemini (Vertex AI) を利用したチャット生成
- text-embedding-004 によるベクトル埋め込み
- Firestore による RAG（ドキュメント検索）
- /rag/ingest による文章チャンク＋埋め込み保存
- /chat による RAG 付き応答生成
- Cloud Run デプロイ対応（healthz あり）

---

## 🚀 API 一覧

| メソッド | パス | 説明 |
|---------|------|------|
| GET `/` | 動作確認（環境変数表示） |
| GET `/healthz` | Cloud Run 用ヘルスチェック |
| POST `/rag/ingest` | RAG 用ドキュメント投入（チャンク化＋埋め込み＋Firestore 保存） |
| POST `/chat` | RAG + Gemini 応答 |

---

## 📦 セットアップ

### 必要環境

- Node.js 18+
- Google Cloud Project  
  - Vertex AI API 有効化  
  - Firestore（Native mode）
  - Cloud Run  
  - サービスアカウントに以下権限  
    - Vertex AI User  
    - Firestore User  
    - Cloud Run Invoker（※公開する場合は allUsers も可）

---

## ⚙️ 環境変数（Cloud Run 用）

| 変数名 | デフォルト値 | 説明 |
|--------|--------------|------|
| `PORT` | 8080 | Express 起動ポート |
| `GOOGLE_CLOUD_PROJECT` | avatar-chat-test-001 | GCP プロジェクトID |
| `VERTEX_LOCATION` | asia-northeast1 | Gemini の実行リージョン |
| `CHAT_MODEL` | gemini-2.5-flash | チャットモデル |
| `EMB_LOCATION` | us-central1 | text-embedding-004 のリージョン |
| `EMB_MODEL` | text-embedding-004 | 埋め込みモデル |
| `RAG_COLLECTION` | valery_docs | Firestore のコレクション名 |

※ とくに text-embedding-004 は **us-central1 推奨**。

---

## 📥 ドキュメント投入（/rag/ingest）

テキストを約 800 文字でチャンクに分割し、  
text-embedding-004 で埋め込みを生成し Firestore に保存します。

### 例：curl

```bash
curl -X POST "$SERVICE_URL/rag/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Valery 会社概要",
    "url": "https://valery-japan.com/company",
    "text": "ここに長文テキスト……"
  }'
