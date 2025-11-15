// index.js — Valery backend（Vertex AI + RAG 付き /chat API）

'use strict';

const express = require('express');
const cors = require('cors');

// Chat 用（Gemini）
const { VertexAI } = require('@google-cloud/vertexai');

// Firestore（RAG用ストレージ）
const { Firestore } = require('@google-cloud/firestore');

// 埋め込み用 Vertex AI (Text Embedding)
const aiplatform = require('@google-cloud/aiplatform');
const { PredictionServiceClient } = aiplatform.v1;
const { helpers } = aiplatform;

// === 環境変数 / デフォルト設定 ==========================
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'avatar-chat-test-001';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'asia-northeast1';
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-2.5-flash';

// Embedding 用（リージョンは us-central1 を推奨）
const EMB_LOCATION = process.env.EMB_LOCATION || 'us-central1';
const EMB_MODEL = process.env.EMB_MODEL || 'text-embedding-004';

// Firestore RAG 用コレクション名
const RAG_COLLECTION = process.env.RAG_COLLECTION || 'valery_docs';

// aiplatform 用クライアント（埋め込み）
const embClient = new PredictionServiceClient({
  apiEndpoint: `${EMB_LOCATION}-aiplatform.googleapis.com`,
});

// 埋め込みモデルのエンドポイント
const EMB_ENDPOINT = `projects/${PROJECT_ID}/locations/${EMB_LOCATION}/publishers/google/models/${EMB_MODEL}`;

// Firestore クライアント
const firestore = new Firestore();

// === Express 初期化 ==================================
const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// Authorization ヘッダは「無視」する（ログだけ）
app.use((req, res, next) => {
  if (req.headers.authorization) {
    console.log('Received Authorization header (ignored in this version).');
  }
  next();
});

// === Vertex AI (チャット) 初期化 ======================
let generativeModel = null;
let initError = null;

async function initVertex() {
  try {
    const vertexAI = new VertexAI({
      project: PROJECT_ID,
      location: VERTEX_LOCATION,
    });

    generativeModel = vertexAI.getGenerativeModel({
      model: CHAT_MODEL,
    });

    console.log('Vertex AI (chat) initialized:', {
      project: PROJECT_ID,
      location: VERTEX_LOCATION,
      model: CHAT_MODEL,
    });
  } catch (err) {
    console.error('Vertex AI init error:', err);
    initError = err;
  }
}

initVertex();

// === ユーティリティ関数群 ==============================

// テキストを 800 文字くらいにチャンクする
function splitIntoChunks(text, maxLength = 800, overlap = 100) {
  const chunks = [];
  let start = 0;
  const len = text.length;

  while (start < len) {
    let end = start + maxLength;
    if (end > len) end = len;

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end === len) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return chunks;
}

// Embedding を 1 テキスト分取得
async function embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const instance = helpers.toValue({
    content: text,
    task_type: taskType, // RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY など
  });

  const parameters = helpers.toValue({});

  const request = {
    endpoint: EMB_ENDPOINT,
    instances: [instance],
    parameters,
  };

  const [response] = await embClient.predict(request);
  const predictions = response.predictions;

  if (!predictions || !predictions.length) {
    throw new Error('No predictions from embedding model');
  }

  // Text Embedding のレスポンス構造をパース
  const p = predictions[0];
  const embeddingsProto = p.structValue.fields.embeddings;
  const valuesProto = embeddingsProto.structValue.fields.values;
  const vec = valuesProto.listValue.values.map((v) => v.numberValue);

  return vec; // number[]
}

// コサイン類似度
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// クエリテキストに近いチャンクを Firestore から検索
async function searchSimilarChunks(queryText, topK = 5) {
  // 1. クエリ側の埋め込み（RETRIEVAL_QUERY）
  const queryEmbedding = await embedText(queryText, 'RETRIEVAL_QUERY');

  // 2. Firestore から全チャンク取得（少量前提）
  const snapshot = await firestore.collection(RAG_COLLECTION).get();
  const scored = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.embedding || !Array.isArray(data.embedding)) return;

    const score = cosineSimilarity(queryEmbedding, data.embedding);
    scored.push({
      id: doc.id,
      title: data.title || '',
      url: data.url || '',
      text: data.text || '',
      score,
    });
  });

  // 3. 類似度でソートして上位 topK を返す
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// === ルート: 動作確認用 ================================
app.get('/', (req, res) => {
  res
    .status(200)
    .type('text/plain')
    .send(
      `Valery backend is running ✅
project=${PROJECT_ID}
chat_location=${VERTEX_LOCATION}
chat_model=${CHAT_MODEL}
emb_location=${EMB_LOCATION}
emb_model=${EMB_MODEL}
rag_collection=${RAG_COLLECTION}`
    );
});

// Health check
app.get('/healthz', (req, res) => {
  if (initError) {
    return res.status(500).json({ ok: false, error: String(initError) });
  }
  res.status(200).json({ ok: true });
});

// === RAG 用：ドキュメント投入 API =======================
// 例:
// curl -X POST "$SERVICE_URL/rag/ingest" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "title": "Valery 会社概要",
//     "url": "https://valery-japan.com/company",
//     "text": "ここに長文テキスト..."
//   }'
app.post('/rag/ingest', async (req, res) => {
  try {
    const { title, url, text } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const safeTitle = title || 'untitled';
    const safeUrl = url || '';

    const chunks = splitIntoChunks(text);
    console.log(
      `Ingesting doc "${safeTitle}" as ${chunks.length} chunks into ${RAG_COLLECTION}`
    );

    const batch = firestore.batch();
    const colRef = firestore.collection(RAG_COLLECTION);

    for (const chunkText of chunks) {
      const embedding = await embedText(chunkText, 'RETRIEVAL_DOCUMENT');

      const docRef = colRef.doc();
      batch.set(docRef, {
        title: safeTitle,
        url: safeUrl,
        text: chunkText,
        embedding,
        createdAt: new Date(),
      });
    }

    await batch.commit();

    res.json({
      ok: true,
      chunks: chunks.length,
    });
  } catch (err) {
    console.error('Error in /rag/ingest:', err);
    res.status(500).json({ error: String(err) });
  }
});

// === メイン: /chat (RAG 付き) ============================
// フロントから { prompt: "..." } を受け取り、
// Firestore から類似チャンクを拾って Gemini に投げる。
app.post('/chat', async (req, res) => {
  try {
    if (initError || !generativeModel) {
      throw initError || new Error('Vertex AI not initialized');
    }

    const prompt = (req.body && req.body.prompt) || '';
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    console.log('Incoming prompt:', prompt);

    // --- 1. RAG で類似チャンク検索 --------------------
    let ragHits = 0;
    let ragSources = [];
    let contextText = '';

    try {
      const hits = await searchSimilarChunks(prompt, 5); // 上位5件
      ragHits = hits.length;
      ragSources = hits.map((h, idx) => ({
        id: h.id,
        title: h.title,
        url: h.url,
        score: h.score,
        index: idx + 1,
      }));

      if (ragHits > 0) {
        contextText = hits
          .map((h, idx) => `【${idx + 1}】${h.title}\n${h.text}`)
          .join('\n\n');
      }
    } catch (ragErr) {
      console.error('RAG search error (ignored, fallback to plain chat):', ragErr);
      ragHits = 0;
      ragSources = [];
      contextText = '';
    }

    // --- 2. Gemini へのプロンプト組み立て --------------
    let contents;

    if (ragHits > 0) {
      const ragPrompt = `
あなたは Valery のAIアシスタントです。
以下は Valery 関連ドキュメントから抽出したコンテキストです。これを最優先で参照し、
利用者の質問に日本語でわかりやすく、過度に断定しすぎない形で回答してください。

[コンテキスト開始]
${contextText}
[コンテキスト終了]

ユーザーからの質問:
${prompt}
      `.trim();

      contents = [{ role: 'user', parts: [{ text: ragPrompt }] }];
    } else {
      contents = [{ role: 'user', parts: [{ text: prompt }] }];
    }

    const result = await generativeModel.generateContent({ contents });

    const textResponse =
      result &&
      result.response &&
      result.response.candidates &&
      result.response.candidates[0] &&
      result.response.candidates[0].content &&
      result.response.candidates[0].content.parts &&
      result.response.candidates[0].content.parts[0] &&
      result.response.candidates[0].content.parts[0].text;

    const reply =
      textResponse ||
      `（テスト応答）Valery backend が受信:「${prompt}」`;

    res.json({
      reply,
      ragUsed: ragHits > 0,
      ragHits,
      ragSources,
    });
  } catch (err) {
    console.error('Error in /chat:', err);
    res.status(500).json({ error: String(err) });
  }
});

// === サーバ起動 =======================================
app.listen(PORT, () => {
  console.log(`Valery backend listening on port ${PORT}`);
});
