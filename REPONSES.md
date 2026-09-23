# Réponses – test technique TanàImmo

## Partie 1 – Revue de code

Pour chaque extrait : bugs, risques sécu et tenue en charge.  
L’extrait A se corrige ici seulement. B et C seront corrigés dans le code ensuite.

### Extrait A – `ListingList` (React)

| Problème | Gravité | Correction proposée |
| --- | --- | --- |
| `useEffect` sans dépendances : le fetch se relance à chaque render | Critique | Ajouter `[city]` |
| Pas de cleanup : une réponse lente peut écraser un state plus récent | Haute | `AbortController` dans le effect 
|
|
| `city` collé brut dans l’URL (espaces, accents) | Moyenne | `encodeURIComponent(city)` |
| Aucune gestion d’erreur : `loading` peut rester à `true` | Haute | `try/catch` + `finally` pour couper le loading 
|
| `<li>` sans `key` | Moyenne | `key={l.id}` 
|
| `price.toLocaleString()` sans contrôle → crash si `price` absent | Moyenne | Afficher un fallback si ce n’est pas un nombre 
|

### Extrait B – `GET /api/listings`

| Problème | Gravité | Correction proposée |
| --- | --- | --- |
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


### Extrait C – webhook paiement

| Problème | Gravité | Correction proposée |
| --- | --- | --- |
| Pas de vérification : n’importe qui peut forger un paiement | Critique | Signature HMAC avant traitement 
|
| Pas d’idempotence : les retries renvoient mail + CRM | Critique | Unique sur `event_id` + update seulement si pas déjà `paid` 
|
| Email + CRM synchrones (jusqu’à 8 s) : risque de timeout 10 s | Critique | Répondre `200` tout de suite, traiter le reste en async 
|
| Un échec email/CRM peut empêcher un ack propre | Haute | Ack d’abord ; logger les erreurs ensuite 
|
| Corps peu contrôlé (`booking_id`, type) | Moyenne | Valider les champs nécessaires 
|
| Pas de raw body : difficile de vérifier la signature | Moyenne | Garder le buffer brut (`rawBody`) 
|

Correctif prévu : `src/api/paymentWebhook.js`.
