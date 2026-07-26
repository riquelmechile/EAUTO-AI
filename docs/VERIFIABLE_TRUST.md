# Verifiable Trust

EAUTO-AI no confía en frases generadas por modelos como “ejecutado”, “aprobado” o “test verde”.

## Cadena obligatoria

```text
Proposal
→ Evidence Bundle
→ Review
→ Approval tied to action hash
→ Execution attempt
→ Provider receipt
→ Verification read
→ Economic outcome
→ Learning eligibility
```

## Receipt chain

Cada recibo contiene:

- Tipo.
- Cuenta.
- Acción.
- Content hash.
- Policy hash.
- Evidence hash.
- Previous receipt hash.
- Payload hash.
- Chain hash.
- Timestamp.

La historia es append-only. Si la acción cambia, la aprobación anterior deja de coincidir con su hash.
