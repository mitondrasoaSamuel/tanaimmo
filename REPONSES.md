# Réponses – test technique TanàImmo

## Partie 1 – Revue de code

Pour chaque extrait : bugs, risques sécu et tenue en charge.  
L’extrait A se corrige ici seulement. B et C sont corrigés dans le dépôt.

### Extrait A – `ListingList` (React)

| Problème | Gravité | Correction proposée |
| --- | --- | --- |
| `useEffect` sans dépendances : le fetch se relance à chaque render | Critique | Ajouter `[city]` 
|
| Pas de cleanup : une réponse lente peut écraser un state plus récent | Haute | `AbortController` dans le
| effect 
|
| `city` collé brut dans l’URL (espaces, accents) | Moyenne | `encodeURIComponent(city)` 
|
| Aucune gestion d’erreur : `loading` peut rester à `true` | Haute | `try/catch` + `finally` pour couper
|  le loading 
|
| `<li>` sans `key` | Moyenne | `key={l.id}` 
|
| `price.toLocaleString()` sans contrôle → crash si `price` absent | Moyenne | Afficher un fallback si ce
|  n’est pas un nombre 
|

### Extrait B – `GET /api/listings`

| Problème | Gravité | Correction proposée 
|
| --- | --- | --- 
|
| Injection SQL : `city` concaténé dans la requête | Critique | Paramètre lié `$1` 
|
| `page` est lu mais jamais utiliséé | Haute | Pagination avec `LIMIT` / `OFFSET` 
|
| N+1 : une requête agency + photos par annonce | Critique | Une seule requête (jointure + photos) 
|
| `SELECT *` renvoie trop de colonnes | Moyenne | Lister seulement les champs utiles 
|
| Pas de validation ni de gestion d’erreur HTTP | Haute | 400 si `city` manquant ; 500 contrôlé 
|
| Pas de limite : toute la ville peut être renvoyée | Haute | Plafond sur `pageSize` 
|

Code corrigé : `src/api/listings.js`.

### Extrait C – webhook paiement

| Problème | Gravité | Correction proposée 
|
| --- | --- | --- 
|
| Pas de vérification : n’importe qui peut forger un paiement | Critique | Signature HMAC avant traitement 
|
| Pas d’idempotence : les retries renvoient mail + CRM | Critique | Unique sur `event_id` + update 
| seulement si pas déjà `paid` 
|
| Email + CRM synchrones (jusqu’à 8 s) : risque de timeout 10 s | Critique | Répondre `200` tout de suite,
| traiter le reste en async 
|
| Un échec email/CRM peut empêcher un ack propre | Haute | Ack d’abord ; logger les erreurs ensuite 
|
| Corps peu contrôlé (`booking_id`, type) | Moyenne | Valider les champs nécessaires 
|
| Pas de raw body : difficile de vérifier la signature | Moyenne | Garder le buffer brut (`rawBody`) 
|

Code corrigé : `src/api/paymentWebhook.js`.

---

## Partie 3 – Gestion d’incident

### 3.1 – Vendredi 21h40, campagne SMS

**0–5 min**  
Je confirme l’alerte (5xx à 35 %, p50 ~9 s), je regarde le trafic depuis 21h30, les routes touchées, CPU/RAM et surtout le pool Postgres.  
Au client : « On traite, le site est dégradé, prochain point dans 15 minutes. »

**Hypothèse principale (extrait B en prod)**  
Le pic SMS tape `GET /api/listings` sans pagination + N+1 → le pool DB sature, la latence et les 5xx montent partout.  
Autres pistes : index manquant sur `city`, timeouts, fuite de connexions.

**Mitigations (même sans cause exacte)**  
1. Rate-limit ou scale de l’API si possible.  
2. Cache court / circuit breaker sur la recherche listings.  
3. Augmenter le pool DB seulement si on voit de l’attente de connexion.  
4. Demander au client de freiner ou suspendre l’envoi SMS.  
5. Déployer le patch B (params liés + jointure + LIMIT) si prêt, avec rollback.

**20–30 min**  
Point client factuel : mesures, actions, prochaine update. Pas de « c’est réparé » tant que les 5xx ne redescendent pas.

**Lendemain**  
Post-mortem court, merger le fix listings, test de charge sur la recherche, revoir les alertes, runbook « avant campagne marketing ».

### 3.2 – Alertes avant lancement

1. **5xx API** > 2 % sur 5 min — Datadog / Grafana (APM ou reverse proxy).  
2. **Latence p95** `/api/*` > 2 s sur 5 min — même APM.  
3. **Pool Postgres** > 80 % des connexions, ou file d’attente > 0 pendant 2 min — exporter Postgres.  
4. **CPU API** > 85 % sur 5 min — métriques host / container.

Objectif : être prévenu avant les utilisateurs, sans trop d’alertes inutiles au quotidien.
