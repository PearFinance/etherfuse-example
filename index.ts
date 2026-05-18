/**
 * Etherfuse Brasil — fluxo completo de on-ramp via PIX
 *
 * Executa três passos em sequência:
 *   1. createCustomer  — registra o usuário e gera o bankAccountId
 *   2. getKycUrl       — URL do onboarding hospedado (usuário escolhe PIX ali)
 *   3. getQuote        — cotação BRL → TESOURO
 *   4. createOnRamp    — abre a ordem; retorna instruções PIX de pagamento
 *
 * Uso:
 *   API_KEY='api_sand:e24f...' npx tsx index.ts
 */

import { Keypair } from '@stellar/stellar-sdk';
import { EtherfuseClient } from './src/lib/anchors/etherfuse';
import type { OnRampTransaction, PixPaymentInstructions } from './src/lib/anchors/types';

// ── Configuração ──────────────────────────────────────────────────────────────

const API_KEY  = process.env.API_KEY  ?? 'api_sand:COLOQUE_SUA_CHAVE_AQUI';
const BASE_URL = process.env.BASE_URL ?? 'https://api.sand.etherfuse.com';

const TESOURO_ISSUER = 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';
const TESOURO        = `TESOURO:${TESOURO_ISSUER}`;
const AMOUNT_BRL     = '100';

const client = new EtherfuseClient({ apiKey: API_KEY, baseUrl: BASE_URL });

// ── Helpers de exibição ───────────────────────────────────────────────────────

const sep = (title: string) =>
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);

function printPixInstructions(pix: PixPaymentInstructions) {
  console.log(`  Chave PIX  : ${pix.pixKey      ?? '—'}`);
  console.log(`  Tipo       : ${pix.pixKeyType   ?? '—'}`);
  console.log(`  Beneficiary: ${pix.beneficiary  ?? '—'}`);
  console.log(`  Valor      : R$ ${pix.amount} ${pix.currency}`);
  if (pix.pixCode) {
    console.log(`\n  BR Code (copia-e-cola):`);
    console.log(`  ${pix.pixCode}`);
  }
}

// ── Fluxo principal ───────────────────────────────────────────────────────────

async function main() {
  // Carteira Stellar do usuário (em produção: provida pelo Freighter/wallet do usuário)
  const wallet = Keypair.random();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Etherfuse Brasil — PIX on-ramp demo');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Wallet     : ${wallet.publicKey()}`);
  console.log(`  Destino    : ${TESOURO}`);
  console.log(`  Valor BRL  : R$ ${AMOUNT_BRL}`);

  // ── Passo 1: createCustomer ───────────────────────────────────────────────
  sep('1 / 4 · createCustomer');

  const customer = await client.createCustomer({
    publicKey : wallet.publicKey(),
    email     : 'usuario@exemplo.com.br',
    country   : 'BR',
  });

  console.log(`  id            : ${customer.id}`);
  console.log(`  bankAccountId : ${customer.bankAccountId}`);
  console.log(`  kycStatus     : ${customer.kycStatus}`);
  console.log(`  country       : ${customer.country ?? 'BR'}`);

  // ── Passo 2: getKycUrl — onboarding hospedado (usuário escolhe PIX) ───────
  sep('2 / 4 · getKycUrl  →  onboarding hospedado');

  const kycUrl = await client.getKycUrl(
    customer.id,
    wallet.publicKey(),
    customer.bankAccountId,
  );

  console.log('  URL de onboarding:');
  console.log(`  ${kycUrl}`);
  console.log('\n  ⚠  O usuário abre esta URL no browser, seleciona "PIX" como');
  console.log('     banco e preenche CPF + chave PIX. O bankAccountId já está');
  console.log('     pré-vinculado; não é necessário nenhuma chamada adicional.');

  // ── Passo 3: getQuote — BRL → TESOURO ────────────────────────────────────
  sep('3 / 4 · getQuote  (sourceAsset=BRL → targetAsset=TESOURO)');

  const quote = await client.getQuote({
    fromCurrency  : 'BRL',
    toCurrency    : TESOURO,
    fromAmount    : AMOUNT_BRL,
    customerId    : customer.id,
    stellarAddress: wallet.publicKey(),
  });

  console.log(`  quoteId      : ${quote.id}`);
  console.log(`  de           : R$ ${quote.fromAmount} BRL`);
  console.log(`  para         : ${quote.toAmount} TESOURO`);
  console.log(`  taxa câmbio  : ${quote.exchangeRate}`);
  console.log(`  fee          : ${quote.fee}`);
  console.log(`  expira em    : ${quote.expiresAt}`);

  // ── Passo 4: createOnRamp ─────────────────────────────────────────────────
  sep('4 / 4 · createOnRamp  →  instruções PIX');

  const onramp: OnRampTransaction = await client.createOnRamp({
    customerId    : customer.id,
    quoteId       : quote.id,
    stellarAddress: wallet.publicKey(),
    fromCurrency  : 'BRL',
    toCurrency    : TESOURO,
    amount        : AMOUNT_BRL,
    bankAccountId : customer.bankAccountId,
  });

  console.log(`  orderId      : ${onramp.id}`);
  console.log(`  status       : ${onramp.status}`);

  if (onramp.paymentInstructions?.type === 'pix') {
    console.log('\n  ── Pagamento PIX ──────────────────────────────────────────');
    printPixInstructions(onramp.paymentInstructions);
  } else if (onramp.paymentInstructions?.type === 'spei') {
    // Fallback: sandbox retornou SPEI em vez de PIX
    console.log('\n  ── Pagamento SPEI (sandbox fallback) ──────────────────────');
    console.log(`  CLABE : ${onramp.paymentInstructions.clabe}`);
    console.log(`  Banco : ${onramp.paymentInstructions.bankName ?? '—'}`);
    console.log(`  Valor : ${onramp.paymentInstructions.amount} ${onramp.paymentInstructions.currency}`);
  } else {
    console.log('\n  (sem instruções de pagamento na resposta do sandbox)');
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Próximos passos em produção:');
  console.log('  1. Usuário completa o KYC na URL acima');
  console.log('  2. Usuário paga o PIX com o BR Code / chave acima');
  console.log('  3. Etherfuse confirma e minta TESOURO na carteira Stellar');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((err: unknown) => {
  const msg = (err as { message?: string })?.message ?? String(err);
  console.error('\n[ERRO]', msg);
  process.exit(1);
});
