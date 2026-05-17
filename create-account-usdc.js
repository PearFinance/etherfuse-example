'use strict';

const { Keypair, Networks, TransactionBuilder, BASE_FEE, Operation, Asset, Memo, Horizon } = require('@stellar/stellar-sdk');
const axios = require('axios');

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

// ── Keypairs ─────────────────────────────────────────────────────────────────
const funder     = Keypair.random();   // Paga a criação e envia USDC
const issuer     = Keypair.random();   // Emissor do USDC de teste
const newAccount = Keypair.random();   // Conta que será criada na transação

// USDC de teste (mesmo nome de asset que o Circle usa — troque o issuer
// por GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 para
// usar o USDC oficial da testnet do Circle, se já tiver saldo lá).
const USDC = new Asset('USDC', issuer.publicKey());

// ── Helpers ───────────────────────────────────────────────────────────────────
async function friendbot(address) {
  await axios.get(`${FRIENDBOT_URL}?addr=${address}`);
  console.log(`  Friendbot → ${address.slice(0, 8)}…`);
}

async function submitTx(tx, label) {
  const res = await server.submitTransaction(tx);
  console.log(`  [${label}] hash: ${res.hash}`);
  return res;
}

// ── Setup: prepara funder e issuer ────────────────────────────────────────────
async function setup() {
  console.log('\n=== Setup ===');
  console.log(`Funder   : ${funder.publicKey()}`);
  console.log(`Issuer   : ${issuer.publicKey()}`);
  console.log(`NewAccount: ${newAccount.publicKey()}`);

  // Financia ambas via Friendbot (XLM de teste)
  await friendbot(funder.publicKey());
  await friendbot(issuer.publicKey());

  const funderAccount = await server.loadAccount(funder.publicKey());

  // Transação de setup: funder adiciona trustline USDC e issuer autoriza emissão
  const setupTx = new TransactionBuilder(funderAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    // Funder adiciona trustline para o USDC do issuer
    .addOperation(Operation.changeTrust({
      asset: USDC,
      limit: '1000',
    }))
    .setTimeout(30)
    .build();

  setupTx.sign(funder);
  await submitTx(setupTx, 'setup-trustline');

  // Issuer emite 100 USDC para o funder (para ter saldo suficiente)
  const issuerAccount = await server.loadAccount(issuer.publicKey());
  const mintTx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: funder.publicKey(),
      asset: USDC,
      amount: '100',
    }))
    .setTimeout(30)
    .build();

  mintTx.sign(issuer);
  await submitTx(mintTx, 'mint-usdc');
}

// ── Transação principal: 3 operações em 1 tx ──────────────────────────────────
async function mainTransaction() {
  console.log('\n=== Transação Principal (3 ops, 2 assinaturas) ===');

  const funderAccount = await server.loadAccount(funder.publicKey());

  const tx = new TransactionBuilder(funderAccount, {
    fee: String(Number(BASE_FEE) * 3), // 3 operações
    networkPassphrase: Networks.TESTNET,
    memo: Memo.text('create+trust+pay'),
  })
    // Op 1 — Cria a nova conta com 2 XLM de saldo mínimo
    .addOperation(Operation.createAccount({
      destination: newAccount.publicKey(),
      startingBalance: '2',
    }))
    // Op 2 — Nova conta adiciona trustline USDC
    //         source explícito = nova conta (exige assinatura dela)
    .addOperation(Operation.changeTrust({
      asset: USDC,
      limit: '1000',
      source: newAccount.publicKey(),
    }))
    // Op 3 — Funder envia 10 USDC para a nova conta
    .addOperation(Operation.payment({
      destination: newAccount.publicKey(),
      asset: USDC,
      amount: '10',
    }))
    .setTimeout(30)
    .build();

  // Ambas as contas precisam assinar — o funder paga e a nova conta aceita a trustline
  tx.sign(funder);
  tx.sign(newAccount);

  const res = await submitTx(tx, 'main-tx');

  console.log('\n✓ Sucesso!');
  console.log(`  Nova conta criada  : ${newAccount.publicKey()}`);
  console.log(`  USDC recebidos     : 10`);
  console.log(`  Stellar Expert     : https://stellar.expert/explorer/testnet/tx/${res.hash}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  try {
    await setup();
    await mainTransaction();
  } catch (err) {
    const detail = err?.response?.data?.extras?.result_codes;
    console.error('Erro:', detail ? JSON.stringify(detail, null, 2) : err.message);
    process.exit(1);
  }
})();
