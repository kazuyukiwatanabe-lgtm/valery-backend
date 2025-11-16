/**
 * update-embedding.js
 *
 * Firestore の rag_documents/{docId} の content を読み出し、
 * Vertex Embedding API (text-embedding-004) で埋め込みを再生成し、
 * Firestore の embedding フィールドを上書きする。
 */

'use strict';

const { Firestore } = require('@google-cloud/firestore');
const { VertexAI } = require('@google-cloud/vertexai');

// ==== 設定 ====
// プロジェクトID
const project = process.env.GOOGLE_CLOUD_PROJECT || 'avatar-chat-test-001';

// text-embedding-004 は us-central1 推奨
const embLocation = process.env.EMB_LOCATION || 'us-central1';
const embModelName = process.env.EMB_MODEL || 'text-embedding-004';

// ==== Firestore ====
const firestore = new Firestore({ projectId: project });

// ==== Vertex Embedding Model (text-embedding-004) ====
const vertexAI = new VertexAI({
  project,
  location: embLocation,
});

const embModel = vertexAI.getGenerativeModel({
  model: embModelName,
});

// ==== Embedding 生成関数 ====
async function embedText(text) {
  const result = await embModel.embedContent({
    content: {
      role: 'user',
      parts: [{ text }],
    },
    taskType: 'RETRIEVAL_DOCUMENT',
  });

  const embedding = result.embedding && result.embedding.values;
  if (!embedding || !embedding.length) {
    throw new Error('No embedding returned from embedding model');
  }

  return embedding;
}

// ==== メイン処理 ====
async function main() {
  const docId = process.argv[2];

  if (!docId) {
    console.error('Usage: node update-embedding.js <docId>');
    process.exit(1);
  }

  console.log(`➡ Firestore: rag_documents/${docId} の embedding を再生成します`);

  const ref = firestore.collection('rag_documents').doc(docId);
  const snap = await ref.get();

  if (!snap.exists) {
    console.error(`❌ Document not found: rag_documents/${docId}`);
    process.exit(1);
  }

  const data = snap.data();
  const content = data.content;

  if (!content) {
    console.error(`❌ content フィールドが見つかりません: rag_documents/${docId}`);
    process.exit(1);
  }

  console.log(`➡ content 読み込み完了（長さ ${content.length}）`);

  // embedding 再生成
  console.log('➡ Embedding を生成中...');
  const embedding = await embedText(content);

  console.log(`➡ Embedding 生成成功（次元数 ${embedding.length}）`);

  // Firestore に書き込み
  await ref.update({ embedding });

  console.log(`✅ Firestore update 完了: rag_documents/${docId}`);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
