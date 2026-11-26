-- Esquema do banco. Roda sempre que o servidor inicia (é seguro repetir).
CREATE TABLE IF NOT EXISTS clinics (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('monthly','annual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  wa_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','receptionist','professional')),
  color TEXT NOT NULL DEFAULT '#F26B1D',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_clinic_idx ON users (clinic_id);

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  phone_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_clinic_idx ON clients (clinic_id, lower(name));
CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients (clinic_id, phone_key);

CREATE TABLE IF NOT EXISTS procedures (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration INT NOT NULL DEFAULT 30 CHECK (duration BETWEEN 5 AND 480),
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS procedures_clinic_idx ON procedures (clinic_id);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id),
  professional_id BIGINT NOT NULL REFERENCES users(id),
  procedure_id BIGINT NOT NULL REFERENCES procedures(id),
  date DATE NOT NULL,
  start_min INT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  duration INT NOT NULL CHECK (duration BETWEEN 5 AND 480),
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','confirmado','atendimento','concluido','cancelado')),
  wa_sent BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMPTZ,
  done_by BIGINT REFERENCES users(id),
  sign_image TEXT,
  photo_image TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appts_day_idx ON appointments (clinic_id, date);
CREATE INDEX IF NOT EXISTS appts_client_idx ON appointments (clinic_id, client_id);

CREATE TABLE IF NOT EXISTS blocks (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  start_min INT NOT NULL,
  end_min INT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blocks_day_idx ON blocks (clinic_id, date);

CREATE TABLE IF NOT EXISTS message_log (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'simulado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS msglog_idx ON message_log (clinic_id, created_at DESC);

-- WhatsApp real: sessão por clínica e detalhes do envio
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS wa_autostart BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT '';
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS appointment_id BIGINT;
CREATE INDEX IF NOT EXISTS msglog_appt_idx ON message_log (clinic_id, appointment_id);

-- Vendas: pacotes e procedimentos pagos
CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id),
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('package','procedure')),
  name TEXT NOT NULL,
  procedure_id BIGINT REFERENCES procedures(id) ON DELETE SET NULL,
  total NUMERIC(12,2) NOT NULL CHECK (total > 0),
  sessions INT NOT NULL DEFAULT 1 CHECK (sessions BETWEEN 1 AND 200),
  valid_until DATE,
  sale_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','cancelada')),
  note TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_clinic_date_idx ON sales (clinic_id, sale_date);
CREATE INDEX IF NOT EXISTS sales_client_idx ON sales (clinic_id, client_id);
CREATE INDEX IF NOT EXISTS sales_appt_idx ON sales (appointment_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('pix','credito','debito','dinheiro','transferencia','outro')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  installments INT NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 24)
);
CREATE INDEX IF NOT EXISTS sale_payments_idx ON sale_payments (sale_id);

-- Sessão de pacote consumida por um agendamento
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appts_sale_idx ON appointments (sale_id);
