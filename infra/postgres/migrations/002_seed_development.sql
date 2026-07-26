BEGIN;
INSERT INTO organizations (id, name) VALUES ('maustian', 'Maustian SpA') ON CONFLICT DO NOTHING;
INSERT INTO commerce_accounts (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
VALUES
  ('plasticov', 'maustian', 'Plasticov', 'mercadolibre', 'MLC', 3500, 'ask'),
  ('maustian', 'maustian', 'Maustian', 'mercadolibre', 'MLC', 3500, 'ask')
ON CONFLICT DO NOTHING;
COMMIT;
