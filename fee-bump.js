'use strict';

/**
 * FeeBumpTransaction — outra conta paga a fee da transação interna.
 *
 * Fluxo:
 *   1. `sender`   assina a transação interna (pagamento de XLM)
 *   2. `feePayer` envolve essa tx num FeeBump e assina por cima
 *   3. Somente `feePayer` paga a fee — `sender` não perde XLM em fee
 */

const {
  Keypair, Networks, TransactionBuilder, BASE_FEE,
  Operation, Horizon, StrKey,
} = require('@stellar/stellar-sdk');
const axios = require('axios');

const server        = new Horizon.Server('https://horizon-testnet.stellar.org');
const FRIENDBOT     = 'https://friendbot.stellar.org';
const NETWORK       = Networks.TESTNET;

// ── Keypairs ──────────────────────────────────────────────────────────────────
const sender   = Keypair.random();   // Origina a transação, NÃO paga fee
const feePayer = Keypair.random();   // Paga a fee no lugar do sender
const receiver = Keypair.random();   // Destino do pagamento

// ── Helpers ───────────────────────────────────────────────────────────────────
const fund    = addr => axios.get(`${FRIENDBOT}?addr=${addr}`);
const submit  = tx   => server.submitTransaction(tx);
const loadAcc = pk   => server.loadAccount(pk);

// ── Setup: financia sender e feePayer via Friendbot ───────────────────────────
async function setup() {
  console.log('\n=== Contas ===');
  console.log(`sender   : ${sender.publicKey()}`);
  console.log(`feePayer : ${feePayer.publicKey()}`);
  console.log(`receiver : ${receiver.publicKey()}`);

  console.log('\n[1] Funding via Friendbot…');
  await Promise.all([fund(sender.publicKey()), fund(feePayer.publicKey())]);

  // Cria a conta do receiver para poder receber pagamentos
  const senderAcc = await loadAcc(sender.publicKey());
  const createTx = new TransactionBuilder(senderAcc, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(Operation.createAccount({
      destination: receiver.publicKey(),
      startingBalance: '1',
    }))
    .setTimeout(30)
    .build();
  createTx.sign(sender);
  await submit(createTx);
  console.log('[2] Conta receiver criada.');
}

// ── Transação interna (assinada só pelo sender) ───────────────────────────────
async function buildInnerTransaction() {
  const senderAcc = await loadAcc(sender.publicKey());

  // fee mínima obrigatória na inner tx (pode ser BASE_FEE ou mais)
  const innerTx = new TransactionBuilder(senderAcc, {
    fee: BASE_FEE,           // Fee declarada, mas será SOBRESCRITA pelo bump
    networkPassphrase: NETWORK,
  })
    .addOperation(Operation.payment({
      destination: receiver.publicKey(),
      asset: require('@stellar/stellar-sdk').Asset.native(),
      amount: '5',
    }))
    .setTimeout(0)           // 0 = sem expiração (necessário para fee bump)
    .build();

  innerTx.sign(sender);      // Somente o sender assina aqui
  return innerTx;
}

// ── FeeBumpTransaction (assinada pelo feePayer) ───────────────────────────────
async function buildAndSubmitFeeBump(innerTx) {
  // A fee do bump deve cobrir todas as ops da inner + 1 op virtual do bump
  // Aqui usamos 3× BASE_FEE para dar margem
  const bumpFee = String(Number(BASE_FEE) * 3);

  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    feePayer,      // Conta que paga
    bumpFee,       // Fee total (em stroops) — cobre a inner tx inteira
    innerTx,       // Transação interna já assinada
    NETWORK,
  );

  feeBumpTx.sign(feePayer);  // Somente o feePayer assina o envelope externo

  console.log('\n=== FeeBumpTransaction ===');
  console.log(`  inner tx hash : ${innerTx.hash().toString('hex')}`);
  console.log(`  bump  tx hash : ${feeBumpTx.hash().toString('hex')}`);
  console.log(`  fee declarada : ${bumpFee} stroops (${Number(bumpFee) / 1e7} XLM)`);
  console.log(`  quem paga fee : ${feePayer.publicKey().slice(0, 8)}…`);

  const result = await submit(feeBumpTx);

  console.log('\n✓ Submetido com sucesso!');
  console.log(`  Stellar Expert: https://stellar.expert/explorer/testnet/tx/${result.hash}`);

  // Confirma que o sender NÃO perdeu XLM em fee
  const senderBalance = (await loadAcc(sender.publicKey()))
    .balances.find(b => b.asset_type === 'native').balance;
  const feePayerBalance = (await loadAcc(feePayer.publicKey()))
    .balances.find(b => b.asset_type === 'native').balance;

  console.log('\n=== Saldos finais (XLM) ===');
  console.log(`  sender   : ${senderBalance}  ← pagou só o valor enviado`);
  console.log(`  feePayer : ${feePayerBalance} ← absorveu a fee`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  try {
    await setup();
    const innerTx = await buildInnerTransaction();
    await buildAndSubmitFeeBump(innerTx);
  } catch (err) {
    const codes = err?.response?.data?.extras?.result_codes;
    console.error('Erro:', codes ? JSON.stringify(codes, null, 2) : err.message);
    process.exit(1);
  }
})();
