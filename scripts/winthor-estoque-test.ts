/**
 * Teste isolado da API de Estoque Disponível do WinThor (stock-vtex).
 *
 * Objetivo: provar que AUTENTICAÇÃO + ENDPOINT + ALCANCE de rede estão ok com
 * UMA única chamada, antes de construir o winthor-sync de verdade. Não toca no
 * banco e não depende do resto do app.
 *
 * Rodar:  npm run winthor:estoque
 *
 * Precisa no .env:
 *   WINTHOR_BASE_URL     começo do endereço. Ex.: https://seu-tunel.ngrok-free.app
 *                        (ou http://10.0.1.3:8069 se a máquina estiver na rede da WIN)
 *   WINTHOR_USER         usuário do WTA
 *   WINTHOR_PASS         senha do WTA em texto puro (o token MD5 é gerado aqui)
 *   WINTHOR_BRANCH_ID    código da filial (default: 1)
 *   WINTHOR_CALL_ORIGIN  'W' (e-commerce, exige produto com Enviar p/ E-commerce=SIM)
 *                        ou 'WSH' (ignora essa restrição). Default: 'W'.
 *                        Se 'W' vier vazio, tente 'WSH' pra testar sem depender do flag.
 */
import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import { createHash } from 'node:crypto';

function md5Upper(s: string): string {
  return createHash('md5').update(s).digest('hex').toUpperCase();
}

async function main(): Promise<void> {
  const baseUrl = process.env.WINTHOR_BASE_URL?.replace(/\/+$/, '');
  const user = process.env.WINTHOR_USER;
  const pass = process.env.WINTHOR_PASS;
  const branchId = process.env.WINTHOR_BRANCH_ID ?? '1';
  const callOrigin = process.env.WINTHOR_CALL_ORIGIN ?? 'W';

  const faltando = [
    !baseUrl && 'WINTHOR_BASE_URL',
    !user && 'WINTHOR_USER',
    !pass && 'WINTHOR_PASS',
  ].filter(Boolean);
  if (faltando.length) {
    console.error(`Faltam variáveis no .env: ${faltando.join(', ')}`);
    process.exit(1);
  }

  // WTA: a senha vai como MD5 em MAIÚSCULAS dentro do Basic Auth (user:md5).
  // Documentado na "Geração de token de autenticação (WTA)". Se der 401, o
  // formato pode ser outro (Bearer via endpoint de token) e a gente ajusta.
  const token = md5Upper(pass!);
  const authHeader = 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');

  const url = `${baseUrl}/api/stock-vtex/v1/available/list`;
  const params = { branchId, callOrigin, page: 0, pageSize: 5, usesPackagingSales: true };

  console.log(`→ GET ${url}`);
  console.log('  params:', params);
  console.log(`  auth: Basic (user=${user}, senha=MD5 maiúsculo)\n`);

  try {
    const { status, data } = await axios.get(url, {
      params,
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true', // pula a tela de aviso do ngrok grátis
      },
      timeout: 20000,
    });
    // A estrutura exata da lista varia; tentamos os formatos mais comuns.
    const arr = Array.isArray(data)
      ? data
      : (data?.items ?? data?.content ?? data?.data ?? data?.list ?? null);
    console.log(`✅ HTTP ${status}`);
    if (Array.isArray(arr)) {
      console.log(`Itens recebidos: ${arr.length}`);
      console.log('\nAmostra (1º item):');
      console.dir(arr[0] ?? '(lista vazia)', { depth: 4 });
      if (arr.length === 0 && callOrigin === 'W') {
        console.log(
          '\nℹ️  Veio vazio com callOrigin=W. Os produtos talvez não estejam com ' +
            '"Enviar para E-commerce = SIM". Tente WINTHOR_CALL_ORIGIN=WSH.',
        );
      }
    } else {
      console.log('Formato inesperado — resposta crua:');
      console.dir(data, { depth: 4 });
    }
  } catch (e) {
    const err = e as AxiosError;
    console.error('❌ Falhou.');
    if (err.response) {
      console.error(`HTTP ${err.response.status}`);
      console.error('Corpo:', JSON.stringify(err.response.data)?.slice(0, 800));
      if (err.response.status === 401 || err.response.status === 403) {
        console.error(
          '\n→ Autenticação recusada. Confira usuário/senha do WTA, ou o formato do ' +
            'token (pode não ser Basic+MD5). Cole aqui a página "Geração de token (WTA)".',
        );
      }
    } else if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(err.code ?? '')) {
      console.error(
        `Sem conexão (${err.code}). Esta máquina não alcança ${baseUrl}. ` +
          'Confira o túnel ngrok / VPN / se está na rede da WIN.',
      );
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
}

main();
