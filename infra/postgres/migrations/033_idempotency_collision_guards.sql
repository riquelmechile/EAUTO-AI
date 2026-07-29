CREATE OR REPLACE FUNCTION assert_scoped_idempotency_content_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_payload jsonb;
  existing_semantic jsonb;
  incoming_semantic jsonb;
  operational_keys text[] := ARRAY[
    'id',
    'conversationId',
    'correlationId',
    'status',
    'attempts',
    'availableAt',
    'leaseOwner',
    'leaseUntil',
    'failureReason',
    'createdAt',
    'updatedAt',
    'completedAt',
    'contentHash'
  ];
BEGIN
  EXECUTE format(
    'SELECT payload_json FROM %I WHERE organization_id = $1 AND account_id = $2 AND idempotency_key = $3 LIMIT 1',
    TG_TABLE_NAME
  )
  INTO existing_payload
  USING NEW.organization_id, NEW.account_id, NEW.idempotency_key;

  IF existing_payload IS NOT NULL THEN
    existing_semantic := existing_payload - operational_keys;
    incoming_semantic := NEW.payload_json - operational_keys;

    IF existing_semantic IS DISTINCT FROM incoming_semantic THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = format(
          'idempotency collision in %s for organization=%s account=%s key=%s',
          TG_TABLE_NAME,
          NEW.organization_id,
          NEW.account_id,
          NEW.idempotency_key
        ),
        DETAIL = 'The same idempotency key was reused with a different semantic payload.',
        HINT = 'Use a new idempotency key or retry the same command payload.';
    END IF;
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
