# Sua Clínica — sistema

Servidor Node.js + PostgreSQL que também entrega as telas (pasta `public/`). Um único serviço no Railway.

## Como publicar no Railway

1. **GitHub:** envie todo o conteúdo desta pasta para o repositório `sua-clinica-app` (sem a pasta `node_modules`).
2. **Railway › serviço do sistema › Settings › Source:** conecte o repositório `sua-clinica-app` (branch `main`).
3. **Variables** (aba do serviço do sistema):
   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (use "Add Reference" apontando para o banco) |
   | `JWT_SECRET` | um texto longo e aleatório (30+ caracteres). Guarde, não compartilhe |
   | `SETUP_KEY` | outro texto longo e aleatório, só para criar clínicas |
4. **Settings › Networking › Generate Domain.** O sistema abre nesse endereço.
5. Os testes de conexão com o banco e a criação das tabelas acontecem sozinhos na primeira subida.

## Criar a primeira clínica

No Windows (PowerShell), trocando o endereço, a chave e os dados:

```powershell
Invoke-RestMethod -Method Post -Uri "https://SEU-ENDERECO.up.railway.app/api/admin/clinics" `
  -Headers @{"x-setup-key"="SUA_SETUP_KEY"} -ContentType "application/json" `
  -Body '{"clinicName":"Clinica Teste","adminName":"Vitoria","email":"voce@email.com","password":"uma-senha-forte-1","plan":"monthly"}'
```

Depois é só entrar no endereço do sistema com esse e-mail e senha. Use `"plan":"annual"` para a clínica do plano anual.
(Evite acentos nesse comando no PowerShell; depois você muda os nomes dentro do sistema.)

## Rodar no seu computador

```
npm install
cp .env.example .env     # preencha DATABASE_URL e JWT_SECRET
npm start
```

## Testes

`DATABASE_URL=postgres://... npm test` (usa um banco de teste e apaga os dados dele).

## Regras de plano (arquivo `src/config.js`)

- Mensal: 2 profissionais + 1 recepcionista.
- Anual: 5 usuários (4 profissionais + 1 recepcionista).
- A administradora (dona da clínica) não entra na conta.

## O que ainda falta

- WhatsApp real (hoje as mensagens são só registradas, em modo de demonstração).
- Webhook do Stripe para criar a clínica e liberar/bloquear o acesso automaticamente.
