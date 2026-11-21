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
