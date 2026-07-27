BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_notifications (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  application_id text NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  seller_id text NOT NULL,
  topic text NOT NULL CHECK (topic IN (
    'items','orders_v2','questions','claims','shipments','payments'
  )),
  resource text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','processed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  last_error text,
  payload_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mercadolibre_notifications_claim_idx
  ON mercadolibre_notifications(status, available_at, lease_until, received_at);
CREATE INDEX IF NOT EXISTS mercadolibre_notifications_account_status_idx
  ON mercadolibre_notifications(account_id, status, received_at DESC);

CREATE OR REPLACE FUNCTION notification_without_lease(payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT payload - 'leaseOwner' - 'leaseUntil';
$$;

COMMIT;
