// server.js

const express = require('express');
const cors = require('cors');
const { VertexAI } = require('@google-cloud/vertexai');
const { Firestore } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library'); // ★ 追加

const app = express();
app.use(cors());
app.use(express.json());

// === 設定 ===
const project = process.env.GOOGLE_CLOUD_PROJECT || 'avatar-chat-test-001';
const location = process.env.VERTEX_LOCATION || 'asia-northeast1';
const chatModelName = process.env.CHAT_MODEL || 'gemini-2.5-flash';
const embModelName = process.env.EMB_MODEL || 'text-embedding-004'; // ★ env からも読めるように

// === Vertex AI 初期化（チャット用）===
let vertexAI;
let generativeModel;

try {
  vertexAI = new VertexAI({ project, location });
  generativeModel = vertexAI.getGenerativeModel({ model: chatModelName });
  console.log(`VertexAI initialized for ${project} @ ${location}, model=${chatModelName}`);
} catch (err) {
  console.error('VertexAI init error:', err);
}

// === Firestore 初期化 ===
const firestore = new Firestore({ projectId: project });

// === Embedding 用 REST クライアント設定 ===

// Vertex Embedding エンドポイント
const vertexEmbEndpoint =
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}` +
  `/publishers/google/models/${embModelName}:predict`;

// 認証クライアント
const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

// ★ テキストを埋め込みベクトルに変換する共通関数
async function embedText(text, taskType = 'RETRIEVAL_QUERY') {
  // Cloud Run (Node18/20/22) なら fetch はグローバルに存在する
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const res = await fetch(vertexEmbEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.token || token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [
        {
          content: text,
          task_type: taskType, // 'RETRIEVAL_QUERY' or 'RETRIEVAL_DOCUMENT'
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Embedding API error:', res.status, body);
    throw new Error(`Embedding API failed: ${res.status}`);
  }

  const data = await res.json();
  // predictions[0].embeddings.values にベクトルが入っている想定
  const embedding = data.predictions[0].embeddings.values;
  return embedding; // [number, number, ...]
}

// === ルート: / （動作確認用 & Cloud Run 健康確認兼用）===
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('text/plain')
    .send(
`Valery backend is running ✅
project=${project}
location=${location}
model=${chatModelName}`
    );
});

// === /chat（通常チャット）===
app.post('/chat', async (req, res) => {
  try {
    if (!generativeModel) {
      return res.status(500).json({ error: 'VertexAI not initialized' });
    }

    const prompt = req.body.prompt || 'こんにちは';

    const result = await generativeModel.generateContent(prompt);
    const reply =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({ reply });
  } catch (err) {
    console.error('Vertex AI error:', err);
    res.status(500).json({ error: err.message });
  }
});

// === /rag-chat（RAGチャット）===
app.post('/rag-chat', async (req, res) => {
  try {
    const prompt = req.body.prompt;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!generativeModel) {
      return res.status(500).json({ error: 'VertexAI not initialized' });
    }

    // ① 入力を embedding に変換
    const queryVector = await embedText(prompt, 'RETRIEVAL_QUERY');

    // ② Firestore から全ドキュメント取得（id も持たせる）
    const docsSnap = await firestore.collection('rag_documents').get();
    const docs = docsSnap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));

    // ③ コサイン類似度でソート（上位3件）
    let ranked = docs
      .map(d => ({
        id: d.id,
        content: d.content,
        score: cosineSimilarity(d.embedding, queryVector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // ★ company_about を必ず含める（なければ既存 ranked に追加）
    const companyDoc = docs.find(d => d.id === 'company_about');
    if (companyDoc && !ranked.some(r => r.id === 'company_about')) {
      ranked = [
        {
          id: companyDoc.id,
          content: companyDoc.content,
          score: 1.0, // 強制ブースト
        },
        ...ranked,
      ].slice(0, 3); // 念のためまた3件に絞る
    }

    // ④ Gemini に質問 + コンテキスト
    const context = ranked.map(r => r.content).join('\n\n');
    const query =
      '以下は、バレリー（Valery）という会社に関する社内データです。\n' +
      'このデータだけを根拠に、日本語で丁寧に回答してください。\n\n' +
      `【社内データ】\n${context}\n\n【質問】\n${prompt}`;

    const result = await generativeModel.generateContent(query);
    const reply =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({ reply, references: ranked });
  } catch (err) {
    console.error('RAG error:', err);
    res.status(500).json({ error: err.message });
  }
});


// === コサイン類似度関数 ===
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (normA * normB);
}

// === サーバ起動（★ 1回だけ）===
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
