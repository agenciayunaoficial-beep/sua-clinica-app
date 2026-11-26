'use strict';
const { PORT } = require('./config');
const { migrate } = require('./db');
const { createApp } = require('./app');
const wa = require('./services/whatsapp');

(async () => {
  try {
    await migrate();
    const server = createApp().listen(PORT, () => console.log(`Sua Clínica no ar na porta ${PORT}`));
    wa.restoreAll();                      // reconecta as clínicas que já tinham o WhatsApp conectado
    const bye = async () => { try { await wa.shutdown(); } catch (_) {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
    process.on('SIGTERM', bye); process.on('SIGINT', bye);
  } catch (e) {
    console.error('Falha ao iniciar:', e.message);
    process.exit(1);
  }
})();
