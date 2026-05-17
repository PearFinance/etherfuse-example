'use strict';

/**
 * Abre uma conta nova onde o SPONSOR paga todas as reservas:
 *   - reserva base da conta  (2 × 0.5 XLM = 1 XLM)
 *   - reserva de cada trustline (0.5 XLM × 3)
 *
 * Total bloqueado no sponsor: 2.5 XLM  (a nova conta fica com 0 XLM próprio)
 *
 * Nota: XLM é o ativo nativo — não precisa de trustline.
 *       O script demonstra 3 trustlines: USDC, EURC e BRLT.
 *       Para usar os issuers reais Circle na testnet, veja os comentários abaixo.
 *
 * Estrutura da transação (1 tx, 6 ops, 2 assinaturas):
 *   Op 1  beginSponsoringFutureReserves  [sponsor → newAccount]
 *   Op 2  createAccount                  [sponsor cria newAccount com 0 XLM]
 *   Op 3  changeTrust USDC               [source: newAccount]
 *   Op 4  changeTrust EURC               [source: newAccount]
 *   Op 5  changeTrust BRLT               [source: newAccount]
 *   Op 6  endSponsoringFutureReserves    [source: newAccount]
 */

const {
  Keypair, Networks, TransactionBuilder, BASE_FEE,
  Operation, Asset, Horizon,
} = require('@stellar/stellar-sdk');
const axios = require('axios');

const server  = new Horizon.Server('https://horizon-testnet.stellar.org');
const NETWORK = Networks.TESTNET;

// ── Contas ────────────────────────────────────────────────────────────────────
const sponsor    = Keypair.random();   // Sua conta principal — paga todas as reservas
const newAccount = Keypair.random();   // Conta nova a ser criada

// ── Ativos (issuers de teste para demo standalone) ────────────────────────────
// Mainnet Circle:
//   USDC → GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
//   EURC → GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP
const usdcIssuer = Keypair.random();
const eurcIssuer = Keypair.random();
const brltIssuer = Keypair.random();

const USDC = new Asset('USDC', usdcIssuer.publicKey());
const EURC = new Asset('EURC', eurcIssuer.publicKey());
const BRLT = new Asset('BRLT', brltIssuer.publicKey()); // BRL Token (XLM é nativo)

// ── Helpers ───────────────────────────────────────────────────────────────────
const fund    = pk => axios.get(`https://friendbot.stellar.org?addr=${pk}`);
const loadAcc = pk => server.loadAccount(pk);
const submit  = tx => server.submitTransaction(tx);

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('\n=== Contas ===');
    console.log(`Sponsor    : ${sponsor.publicKey()}`);
    console.log(`NewAccount : ${newAccount.publicKey()}`);

    console.log('\n[1] Financiando sponsor e issuers via Friendbot…');
    await Promise.all([
      fund(sponsor.publicKey()),
      fund(usdcIssuer.publicKey()),
      fund(eurcIssuer.publicKey()),
      fund(brltIssuer.publicKey()),
    ]);

    const sponsorAcc = await loadAcc(sponsor.publicKey());
    const sponsorBefore = sponsorAcc.balances.find(b => b.asset_type === 'native').balance;

    console.log(`    Saldo inicial do sponsor : ${sponsorBefore} XLM`);
    console.log('\n[2] Construindo transação (6 ops)…');

    const tx = new TransactionBuilder(sponsorAcc, {
      fee: String(Number(BASE_FEE) * 6),
      networkPassphrase: NETWORK,
    })
      // Op 1 — Abre o bloco de sponsorship: sponsor pagará as próximas reservas de newAccount
      .addOperation(Operation.beginSponsoringFutureReserves({
        sponsoredId: newAccount.publicKey(),
      }))
      // Op 2 — Cria a conta com startingBalance 0 (reserva base sponsorizada)
      .addOperation(Operation.createAccount({
        destination: newAccount.publicKey(),
        startingBalance: '0',
      }))
      // Op 3 — Trustline USDC (0.5 XLM de reserva paga pelo sponsor)
      .addOperation(Operation.changeTrust({
        asset: USDC,
        limit: '1000000',
        source: newAccount.publicKey(),
      }))
      // Op 4 — Trustline EURC (0.5 XLM de reserva paga pelo sponsor)
      .addOperation(Operation.changeTrust({
        asset: EURC,
        limit: '1000000',
        source: newAccount.publicKey(),
      }))
      // Op 5 — Trustline BRLT (0.5 XLM de reserva paga pelo sponsor)
      .addOperation(Operation.changeTrust({
        asset: BRLT,
        limit: '1000000',
        source: newAccount.publicKey(),
      }))
      // Op 6 — newAccount encerra o bloco; reservas futuras não são mais sponsorizadas
      .addOperation(Operation.endSponsoringFutureReserves({
        source: newAccount.publicKey(),
      }))
      .setTimeout(30)
      .build();

    // Ambas as contas precisam assinar
    tx.sign(sponsor);
    tx.sign(newAccount);

    console.log('[3] Submetendo…');
    const result = await submit(tx);

    // ── Resultados ────────────────────────────────────────────────────────────
    const newAcc      = await loadAcc(newAccount.publicKey());
    const sponsorAcc2 = await loadAcc(sponsor.publicKey());

    const BASE_RESERVE   = 0.5;        // XLM por sub-entry
    const numSponsoring  = Number(sponsorAcc2.num_sponsoring); // entradas patrocinadas
    const reservaTotal   = numSponsoring * BASE_RESERVE;
    const newAccXLM      = newAcc.balances.find(b => b.asset_type === 'native').balance;
    const sponsorAfter   = sponsorAcc2.balances.find(b => b.asset_type === 'native').balance;
    const feePaga        = (Number(sponsorBefore) - Number(sponsorAfter)).toFixed(7);

    // saldo_min = (2 + sub_entries + num_sponsoring) × base_reserve
    const subEntries     = Number(sponsorAcc2.subentry_count);
    const saldoMinSponsor = (2 + subEntries + numSponsoring) * BASE_RESERVE;

    console.log('\n✓ Conta criada com sucesso!');
    console.log(`  Hash          : ${result.hash}`);
    console.log(`  Stellar Expert: https://stellar.expert/explorer/testnet/tx/${result.hash}`);

    console.log('\n=== Nova conta ===');
    console.log(`  XLM próprio : ${newAccXLM} XLM  ← zero (reserva base sponsorizada)`);
    console.log(`  Sponsor     : ${newAcc.sponsor?.slice(0, 8)}…`);
    console.log('  Trustlines  :');
    newAcc.balances
      .filter(b => b.asset_type !== 'native')
      .forEach(b => {
        console.log(`    ${b.asset_code.padEnd(6)} | sponsor: ${b.sponsor?.slice(0, 8)}…`);
      });

    console.log('\n=== Sponsor (sua conta principal) ===');
    console.log(`  Saldo XLM        : ${sponsorAfter} XLM`);
    console.log(`  Fee paga         : ${feePaga} XLM`);
    console.log(`  Entradas patroc. : ${numSponsoring}  (1 conta + 3 trustlines)`);
    console.log(`  Reserva comprometida: ${reservaTotal.toFixed(1)} XLM  (${numSponsoring} × 0.5)`);
    console.log(`  Saldo mínimo obrig.: ${saldoMinSponsor.toFixed(1)} XLM  ← não pode gastar abaixo disso`);

  } catch (err) {
    const codes = err?.response?.data?.extras?.result_codes;
    console.error('Erro:', codes ? JSON.stringify(codes, null, 2) : err.message);
    process.exit(1);
  }
})();
