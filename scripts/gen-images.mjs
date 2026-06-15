// Gera imagens de arte (fundo/lifestyle) para o catálogo via OpenAI Images.
// Usa a OPENAI_API_KEY do .env. NÃO gera "foto de produto" — só atmosfera/arte.
// Uso: node scripts/gen-images.mjs <chave-do-JOBS> [todas]
import { readFileSync, writeFileSync } from 'node:fs';

const MODEL = 'gpt-image-2';

function lerChave() {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
  if (!m) throw new Error('OPENAI_API_KEY não encontrada no .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const PALETA =
  'paleta de cores: azul-marinho bem escuro (#0b1530) dominante e dourado quente (#e6b94d) como luz de destaque';

const JOBS = {
  'hero-bg': {
    arquivo: 'public/hero-bg.webp',
    size: '1536x1024',
    prompt: `Fundo publicitário cinematográfico para loja de suplementos esportivos premium. Atmosfera escura e sofisticada, academia high-end, luz dourada rasante (rim light) vinda da direita, partículas/poeira de luz sutis, sensação de energia e força. SEM texto, SEM logotipos, SEM produtos, SEM pessoas em foco. Lado esquerdo mais escuro e limpo (espaço negativo para título). ${PALETA}. Estilo: foto de estúdio de alto padrão, profundidade, elegante, minimalista.`,
  },
  'banner-treino': {
    arquivo: 'public/banner-treino.webp',
    size: '1536x1024',
    prompt: `Banner lifestyle para suplementos: textura de academia escura premium com halteres desfocados ao fundo, luz dourada dramática, vapor/energia. SEM texto, SEM rótulos legíveis, SEM marcas. Composição com bastante espaço negativo escuro à esquerda. ${PALETA}. Foto cinematográfica, contraste alto, classe.`,
  },
};

async function gerar(chaveJob, key) {
  const job = JOBS[chaveJob];
  if (!job) throw new Error(`job desconhecido: ${chaveJob}`);
  const body = {
    model: MODEL,
    prompt: job.prompt,
    size: job.size,
    n: 1,
    output_format: 'webp',
    output_compression: 82,
  };
  let res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  // Se reclamar de algum parâmetro novo, tenta de novo no modo mínimo.
  if (res.status === 400) {
    const t = await res.text();
    console.warn(`[${chaveJob}] 400 no modo completo, tentando mínimo:`, t.slice(0, 300));
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, n: 1 }),
    });
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 600)}`);
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`resposta sem b64_json: ${JSON.stringify(data).slice(0, 300)}`);
  writeFileSync(new URL(`../${job.arquivo}`, import.meta.url), Buffer.from(b64, 'base64'));
  console.log(`OK -> ${job.arquivo}`);
}

const key = lerChave();
const alvo = process.argv[2];
const alvos = alvo === 'todas' ? Object.keys(JOBS) : [alvo].filter(Boolean);
if (alvos.length === 0) { console.error('passe um job:', Object.keys(JOBS).join(', '), 'ou "todas"'); process.exit(1); }
for (const a of alvos) await gerar(a, key);
console.log('done');
