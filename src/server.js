'use strict';
const { PORT } = require('./config');
const { migrate } = require('./db');
const { createApp } = require('./app');

(async () => {
  try {
    await migrate();
    createApp().listen(PORT, () => console.log(`Sua Clínica no ar na porta ${PORT}`));
  } catch (e) {
    console.error('Falha ao iniciar:', e.message);
    process.exit(1);
  }
})();
