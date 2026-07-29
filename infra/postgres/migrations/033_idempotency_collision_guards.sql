CREATE OR REPLACE FUNCTION assert_scoped_idempotency_content_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_hash text;
BEGIN
  EXECUTE format(
    'SELECT content_hash FROM %I WHERE organization_id = $1 AND account_id = $2 AND idempotency_key = $3 LIMIT 1',
    TG_TABLE_NAME
  )
  INTO existing_hash
  USING NEW.organization_id, NEW.account_id, NEW.idempotency_key;

  IF existing_hash IS NOT NULL AND existing_hash <> NEW.content_hash THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'idempotency collision in %s for organization=%s account=%s key=%s',
        TG_TABLE_NAME,
        NEW.organization_id,
        NEW.account_id,
        NEW.idempotency_key
      ),
      DETAIL = 'The same idempotency key was reused with a different content hash.',
      HINT = 'Use a new idempotency key or retry the exact original request.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_messages_idempotency_collision_guard ON agent_messages;
CREATE TRIGGER agent_messages_idempotency_collision_guard
BEFORE INSERT ON agent_messages
FOR EACH ROW
EXECUTE FUNCTION assert_scoped_idempotency_content_hash();

DROP TRIGGER IF EXISTS evidence_requests_idempotency_collision_guard ON evidence_requests;
CREATE TRIGGER evidence_requests_idempotency_collision_guard
BEFORE INSERT ON evidence_requests
FOR EACH ROW
EXECUTE FUNCTION assert_scoped_idempotency_content_hash();
