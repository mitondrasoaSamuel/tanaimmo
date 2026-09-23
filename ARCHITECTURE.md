# Architecture – TanàImmo (extrait fiabilité)

Projet réduit pour le test technique : corrections d’API, webhook paiement, connecteur CRM.
Pas de base PostgreSQL réelle ni de serveur HTTP démarré : les dépendances DB/Express sont injectées ou simulées.

## Structure

```
src/
  api/
    listings.js          # route GET /api/listings (extrait B corrigé)
    paymentWebhook.js    # route POST /webhooks/payment (extrait C corrigé)
  crm/
    crmClient.js         # createLead + retries / backoff / idempotence
    crmClient.test.js    # tests unitaires (API mockée)
  lib/
    db.js                # interface minimale attendue du client SQL
```

## Décisions

- **Listings** : paramètres liés (`$1`), jointure + sous-requête pour éviter le N+1, pagination `LIMIT/OFFSET`, projection de colonnes.
- **Webhook** : vérification de signature, ack HTTP rapide, traitement métier asynchrone, garde d’idempotence sur le statut booking / event_id.
- **CRM** : timeout 5 s, backoff exponentiel, respect de `Retry-After` sur 429, pas de retry sur 4xx définitifs, header `Idempotency-Key`, token jamais loggé.

## Dépendances

Aucune dépendance npm runtime. Tests via `node:test` / `node:assert` (Node ≥ 18).
