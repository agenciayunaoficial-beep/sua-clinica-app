'use strict';
const onRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;
const isProd = process.env.NODE_ENV === 'production' || onRailway;

const JWT_SECRET = process.env.JWT_SECRET || (isProd ? '' : 'dev-secret-nao-usar-em-producao');
if (!JWT_SECRET) {
  console.error('ERRO: defina a variável JWT_SECRET no Railway (um texto longo e aleatório).');
  process.exit(1);
}

/**
 * Limites de cada plano (sem contar a administradora/dona da clínica).
 * Mensal: 2 profissionais + 1 recepcionista.
 * Anual: 5 usuários no total (4 profissionais + 1 recepcionista).
 * Ajuste aqui se a regra do anual for diferente.
 */
const PLANS = {
  monthly: { label: 'Mensal', professionals: 2, receptionists: 1 },
  annual: { label: 'Anual', professionals: 4, receptionists: 1 }
};

const DEFAULT_WA_TEMPLATES = {
  conf: 'Olá, {nome}! 😊 Aqui é da {clinica}.\nConfirmamos seu horário de {procedimento} com {profissional} em {data} às {hora}.\nResponda *1* para confirmar ou *2* para remarcar.',
  lemb: 'Oi, {nome}! Lembrete: amanhã às {hora} você tem {procedimento} na {clinica}. Te esperamos! 💖',
  agenda: 'Bom dia, {profissional}! Sua agenda de {data}:\n{lista}'
};

module.exports = {
  isProd,
  secureCookies: isProd,
  JWT_SECRET,
  PORT: Number(process.env.PORT) || 3000,
  SETUP_KEY: process.env.SETUP_KEY || '',
  PLANS,
  DEFAULT_WA_TEMPLATES,
  OPEN_MIN: 8 * 60,
  CLOSE_MIN: 19 * 60,
  MAX_IMAGE_CHARS: 1_600_000
};
