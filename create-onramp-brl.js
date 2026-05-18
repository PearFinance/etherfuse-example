'use strict';

/**
 * createOnrampOrderBRL(amountBRL, stellarPublicKey)
 *
 * 1. POST /ramp/quote  — obtém cotação BRL → TESOURO
 * 2. POST /ramp/order  — abre a ordem usando o quoteId retornado
 *
 * Retorna: { orderId, pixKey, pixKeyType, pixCode, depositAmount }
 *
 * Variáveis de ambiente necessárias:
 *   API_KEY          — ex: api_sand:e24f...
 *   CUSTOMER_ID      — UUID do cliente já cadastrado
 *   BANK_ACCOUNT_ID  — UUID da conta PIX vinculada ao cliente
 */

const { randomUUID } = require('crypto');

// ── Configuração ──────────────────────────────────────────────────────────────

const API_KEY         = process.env.API_KEY         ?? 'api_sand:e24f...';
const CUSTOMER_ID     = process.env.CUSTOMER_ID     ?? '';
const BANK_ACCOUNT_ID = process.env.BANK_ACCOUNT_ID ?? '';
const BASE_URL        = 'https://api.sand.etherfuse.com';
const TESOURO         = 'TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';

// ── Helper HTTP ───────────────────────────────────────────────────────────────

async function post(endpoint, body) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`→ POST ${endpoint}`, JSON.stringify(body));

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization : API_KEY,          // sem prefixo Bearer
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`← ${res.status}`, text || '(vazio)');

  if (!res.ok) {
    let detail = text;
    try { detail = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    throw new Error(`${endpoint} falhou (${res.status}):\n${detail}`);
  }

  return JSON.parse(text);
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * @param {string|number} amountBRL       — valor em BRL (ex: '100' ou 100)
 * @param {string}        stellarPublicKey — chave pública G... do usuário
 * @returns {{ orderId, pixKey, pixKeyType, pixCode, depositAmount }}
 */
async function createOnrampOrderBRL(amountBRL, stellarPublicKey) {
  // ── Passo 1: cotação ─────────────────────────────────────────────────────
  const quoteId = randomUUID();

  const quoteRes = await post('/ramp/quote', {
    quoteId,
    customerId  : CUSTOMER_ID,
    blockchain  : 'stellar',
    quoteAssets : {
      type       : 'onramp',
      sourceAsset: 'BRL',
      targetAsset: TESOURO,
    },
    sourceAmount : String(amountBRL),
    walletAddress: stellarPublicKey,
  });

  // A API retorna o quoteId confirmado — pode diferir do enviado
  const confirmedQuoteId = quoteRes.quoteId ?? quoteId;

  // ── Passo 2: ordem ───────────────────────────────────────────────────────
  const orderId = randomUUID();

  const orderRes = await post('/ramp/order', {
    orderId,
    quoteId      : confirmedQuoteId,
    publicKey    : stellarPublicKey,
    bankAccountId: BANK_ACCOUNT_ID,
  });

  const onramp = orderRes.onramp;

  return {
    orderId      : onramp.orderId,
    depositAmount: onramp.depositAmount,
    pixKey       : onramp.depositPixKey     ?? null,
    pixKeyType   : onramp.depositPixKeyType ?? null,
    pixCode      : onramp.depositPixCode    ?? null, // BR Code copia-e-cola
  };
}

// ── Demo / execução direta ────────────────────────────────────────────────────

(async () => {
  if (!CUSTOMER_ID || !BANK_ACCOUNT_ID) {
    console.error([
      '',
      'Configure as variáveis de ambiente antes de executar:',
      '',
      '  export API_KEY="api_sand:e24f..."',
      '  export CUSTOMER_ID="uuid-do-cliente"',
      '  export BANK_ACCOUNT_ID="uuid-da-conta-pix"',
      '',
      'Esses IDs são gerados pelo createCustomer (ver index.ts).',
    ].join('\n'));
    process.exit(1);
  }

  const WALLET = process.argv[2] ?? 'GDAZYPTBWWJC5UBOGYXJ3L55QXQPEIWJMOJPBPY6GM6SNMCMEWMCGHPR';
  const AMOUNT = process.argv[3] ?? '100';

  console.log('\n══ createOnrampOrderBRL ══════════════════════════════════');
  console.log(`   amountBRL         : R$ ${AMOUNT}`);
  console.log(`   stellarPublicKey  : ${WALLET}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const result = await createOnrampOrderBRL(AMOUNT, WALLET);

  console.log('\n══ Resultado ══════════════════════════════════════════════');
  console.log(`   orderId      : ${result.orderId}`);
  console.log(`   depositAmount: R$ ${result.depositAmount}`);
  console.log(`   pixKey       : ${result.pixKey       ?? '—'}`);
  console.log(`   pixKeyType   : ${result.pixKeyType   ?? '—'}`);
  console.log(`   pixCode      : ${result.pixCode      ?? '—'}`);
  console.log('══════════════════════════════════════════════════════════\n');
})();

module.exports = { createOnrampOrderBRL };
