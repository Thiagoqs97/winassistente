import { pool } from '../db/pool.js';

// Debouncer distribuído de mensagens por vendedor.
//
// Problema: quando o vendedor manda várias mensagens em sequência (típico em
// pedidos com 3-4 imagens), cada uma dispara uma invocação do webhook, e cada
// invocação roda o pipeline completo do LLM. O resultado é várias respostas
// para um único contexto, com custo e latência multiplicados.
//
// Solução: cada mensagem entra com um `seq` autoincrement na tabela
// mensagens_buffer. A invocação espera N segundos e checa se chegou alguma
// mensagem com seq maior. Se sim, desiste (alguém mais novo vai processar
// o lote inteiro). Se não, marca todas as entradas pendentes do vendedor
// como processadas e segue.
//
// Funciona em qualquer ambiente — não depende de memória in-process. Compatível
// com Vercel serverless (Active CPU pricing não cobra wall-clock de sleep).

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retorna true se esta invocação é a "vencedora" do lote e deve processar.
// Retorna false se outra mensagem mais nova já chegou — esta invocação para aqui.
export async function debounceMensagem(vendedorId: string, delaySeconds: number): Promise<boolean> {
  if (delaySeconds <= 0) return true;

  const { rows } = await pool.query(
    `INSERT INTO mensagens_buffer (vendedor_id) VALUES ($1) RETURNING seq`,
    [vendedorId]
  );
  const meuSeq: number = Number(rows[0].seq);

  await sleep(delaySeconds * 1000);

  // Há alguma mensagem mais nova ainda pendente para o mesmo vendedor?
  const { rows: maxRows } = await pool.query(
    `SELECT COALESCE(MAX(seq), 0)::bigint AS max_seq
     FROM mensagens_buffer
     WHERE vendedor_id = $1 AND processada_em IS NULL`,
    [vendedorId]
  );
  const maxSeq = Number(maxRows[0].max_seq);

  if (maxSeq > meuSeq) {
    // Não sou o último — a invocação que recebeu maxSeq vai processar o lote.
    return false;
  }

  // Sou o último. Marca tudo até o meu seq como processado.
  await pool.query(
    `UPDATE mensagens_buffer
     SET processada_em = NOW()
     WHERE vendedor_id = $1 AND processada_em IS NULL AND seq <= $2`,
    [vendedorId, meuSeq]
  );
  return true;
}
