'use strict';

const axios = require('axios');

// Chave lida da variável de ambiente ou fallback para o valor direto.
// Uso recomendado: API_KEY=api_sand:e24f... node etherfuse-assets.js
const API_KEY = process.env.API_KEY || 'api_sand:e24f...';

(async () => {
  try {
    const res = await axios.get('https://api.sand.etherfuse.com/v1/assets', {
      headers: {
        Authorization: API_KEY,   // sem prefixo "Bearer"
        'Content-Type': 'application/json',
      },
      // Não lança exceção em erros HTTP — capturamos o status manualmente
      validateStatus: () => true,
    });

    console.log(`Status HTTP : ${res.status} ${res.statusText}`);
    console.log('Body       :');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    // Erro de rede (sem resposta do servidor)
    console.error('Erro de rede:', err.message);
    process.exit(1);
  }
})();
