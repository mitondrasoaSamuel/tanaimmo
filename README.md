# TanàImmo – test technique (maintenance & fiabilité)

Rendu pour le poste Développeur Web React – Maintenance et fiabilité de plateforme.

## Temps passé

Environ **1 h 50** (partie 1 ~50 min, partie 2 ~40 min, partie 3 ~20 min).

## Ce qui a été fait

| Partie | Contenu |
|--------|---------|
| 1 | Diagnostic des extraits A/B/C dans `REPONSES.md`. Versions corrigées de **B** (`src/api/listings.js`) et **C** (`src/api/paymentWebhook.js`). |
| 2 | Module `src/crm/crmClient.js` : timeout 5 s, retries + backoff, `Retry-After`, pas de retry sur 4xx définitifs, `Idempotency-Key`, token hors logs/erreurs. Tests mockés. |
| 3 | Scénario incident + alertes pré-lancement dans `REPONSES.md`. |

## Ce qui n’a pas été fait

- Pas de serveur Express démarrable ni de PostgreSQL : les routes B/C sont des modules enregistrables, prêts à brancher sur une app existante.
- Pas de correction code de l’extrait A (demandé sur le papier uniquement).
- Pas de migration SQL livrée pour `payment_events` (contrainte unique `event_id` assumée côté schéma).
- Pas de tests d’intégration HTTP sur B/C.

## Lancer les tests

Prérequis : Node.js ≥ 18.

```bash
npm test
```

Les deux cas demandés (`429` puis succès, `500` × 3 puis abandon) sont couverts. Un troisième test vérifie l’absence de retry sur `400`.

## Configuration

Copier `.env.example` vers `.env` et renseigner `CRM_API_TOKEN` / `PAYMENT_WEBHOOK_SECRET`. Aucun secret n’est versionné.

## Structure

Voir `ARCHITECTURE.md`.
