/**
 * update-embedding.js
 * 
 * Firestore の rag_documents/{docId} の content を読み出し、
 * Vertex Embedding API (text-embedding-004) で埋め込みを再生成し、
 * Firestore の embedding フィールドを上書きする。
 */

const { Firestore } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library');

// ==== 設定 ====
const project = process.env.GOOGLE_CLOUD_PROJECT || 'avatar-chat-test-001';
const location = process.env.VERTEX_LOCATION || 'asia-northeast1';
const embModelName = process.env.EMB_MODEL || 'text-embedding-004';

// ==== Firestore ====
const firestore = new Firestore({ projectId: project });

// ==== Vertex Embedding Endpoint ====
const vertexEmbEndpoint =
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}` +
  `/publishers/google/models/${embModelName}:predict`;

// ==== 認証 ====
const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

// ==== Embedding 生成関数 ====
async function embedText(text) {
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
          task_type: 'RETRIEVAL_DOCUMENT',
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding API error: ${res.status} - ${body}`);
  }

  const data = await res.json();
  const embedding = data.predictions[0].embeddings.values;
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

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
