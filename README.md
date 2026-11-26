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

Para testar o WhatsApp localmente é preciso ter o Google Chrome/Chromium instalado (`PUPPETEER_EXECUTABLE_PATH` aponta para ele).

## Testes

`DATABASE_URL=postgres://... npm test` (usa um banco de teste e apaga os dados dele).

## Regras de plano (arquivo `src/config.js`)

- Mensal: 2 profissionais + 1 recepcionista.
- Anual: 5 usuários (4 profissionais + 1 recepcionista).
- A administradora (dona da clínica) não entra na conta.

## WhatsApp real

- O repositório tem um `Dockerfile`: o Railway passa a construir o sistema com o Chromium instalado (a primeira construção demora mais).
- Na aba **WhatsApp** do sistema, a clínica clica em *Conectar WhatsApp* e lê o QR Code no celular (Aparelhos conectados › Conectar um aparelho).
- As mensagens entram numa fila e saem com pausa de 4 a 9 segundos entre uma e outra. O resultado (enviado / falhou) aparece na lista de mensagens.
- Se o cliente responde **1**, o agendamento vira "Confirmado". Se responde **2**, a recepção vê o aviso para remarcar.
- **Guardar a conexão entre atualizações:** no Railway, crie um **Volume** no serviço do sistema, monte em `/data` e adicione a variável `WA_DATA_DIR` = `/data/wwebjs`. Sem o volume, a clínica precisa ler o QR Code de novo a cada atualização do sistema.
- Variáveis opcionais: `WA_MAX_SESSIONS` (clínicas conectadas ao mesmo tempo, padrão 5), `WA_MIN_GAP_MS` / `WA_MAX_GAP_MS` (pausa entre mensagens), `WA_DRIVER=demo` (desliga a conexão real).
- Cada clínica conectada mantém um Chromium aberto (cerca de 300 a 500 MB de memória). Acompanhe o uso no Railway.

## Vendas e pacotes

- No atendimento (agenda), botão **Lançar venda / pagamento**: pacote ou procedimento avulso, valor, forma de pagamento (Pix, crédito com parcelas, débito, dinheiro…) e divisão em mais de uma forma. O atendimento fica com a etiqueta **Paga**.
- Pacotes têm quantidade de sessões e validade. Ao agendar, escolha "Sessão de pacote"; a ficha do cliente mostra sessões feitas, agendadas e o período.
- Menu **Vendas**: faturamento, número de vendas, ticket médio (faturamento ÷ vendas), mais vendidos e formas de pagamento do mês, com comparação com o mês anterior.
- Só administradora e recepção veem vendas. Só a administradora cancela uma venda.

## O que ainda falta

- Webhook do Stripe para criar a clínica e liberar/bloquear o acesso automaticamente.
