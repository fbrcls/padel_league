# Padel League La Cure

Application web en français pour programmer les matchs, encoder les jeux, confirmer ou contester les résultats et suivre le classement. Un accès organisateur permet de gérer les résultats et les liens personnels.

## État de cette version

- React / TypeScript / Vite ; API Hono sur Cloudflare Workers.
- PostgreSQL Neon en production ; PostgreSQL embarqué PGlite en local, sans compte externe.
- Composition initiale : 66 paires, 11 box ; identités fusionnées après confirmation (voir `db/seed/README.md`).
- Cycle du 12 octobre au 29 novembre 2026 ; saisie jusqu'au 1er décembre à 23 h 59 belge. Les confirmations et contestations continuent ensuite.
- Tests automatisés métier/API et parcours navigateur fournis.
- Aucun déploiement public effectué. Neon, sa région UE et les conditions gratuites sans carte doivent être vérifiés avec les comptes de l'organisateur.

Voir [les spécifications fonctionnelles](SPECIFICATIONS.md) et [les spécifications techniques](SPECIFICATIONS_TECHNIQUES.md).

## Démarrage local

Node.js 24 et npm. Depuis la racine du dépôt :

```sh
npm ci
npm run db:prepare
npm run dev
```

L'interface utilise le port 5173 et l'API le port 8787. Ouvrir `http://localhost:5173` sur la machine de développement. Utiliser exactement `localhost` pour l'interface : les mutations vérifient l'origine. Ce mode n'est pas destiné à une exposition publique ; l'API reste liée à l'interface locale.

Dans l'interface, cliquer sur **Organisation** et utiliser le mot de passe du fichier privé `.local/admin-password.txt`. Dans l'onglet Organisation, retrouver un joueur et afficher son lien personnel. Tester les joueurs dans des profils de navigateur distincts de celui de l'organisateur.

Le premier démarrage crée des secrets aléatoires locaux et les liens des joueurs. Les suivants les réutilisent. Les données sont conservées dans `.local/postgres`. **Ne pas lancer deux processus PGlite sur le même répertoire** : arrêter `npm run dev` avant `db:prepare` ou `export` en mode local. Les tests API utilisent une base en mémoire indépendante.

`.local`, `.dev.vars`, les exports et les secrets sont ignorés par Git. Ne jamais copier un secret ou un lien personnel dans un ticket ou une conversation.

## Vérifications

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Le test navigateur lance automatiquement le serveur local et utilise Chromium. Sur Linux avec Chromium installé, la configuration utilise `/usr/bin/chromium`. Ailleurs, définir `CHROMIUM_PATH` avec le chemin du navigateur ou adapter la configuration pour un navigateur installé via Playwright. Le mode `--no-sandbox` des tests est destiné au conteneur de développement ; il ne concerne pas l'application déployée.

Le test crée un résultat de démonstration puis l'annule avec historique dans la base locale. Pour une base de développement vide, après sauvegarde et arrêt du serveur, retirer uniquement `.local/postgres` puis relancer `db:prepare`. Ne jamais appliquer cette procédure à la production.

## Préparation Cloudflare / Neon

### Vérifier les offres avant inscription

Vérifier l'absence de carte obligatoire, les quotas gratuits, la région européenne de Neon, le coût CPU Workers, Workers KV, les Cron Triggers et les conditions d'utilisation pour un club. Ne pas activer de plan payant. Les pages officielles n'étaient pas accessibles depuis l'environnement de rédaction ; ces conditions ne sont pas garanties par ce dépôt.

### Préparer Neon sans partager de connexion

Dans le projet Neon, ouvrir **SQL Editor** et sélectionner la base `neondb`. Si l’éditeur affiche « Failed transaction », cliquer d’abord sur **ROLLBACK**. Exécuter ensuite séparément, dans cet ordre :

1. [db/neon/01-schema.sql](db/neon/01-schema.sql) : tables et migrations.
2. [db/neon/02-joueurs.sql](db/neon/02-joueurs.sql) : cycle et joueurs.
3. [db/neon/03-paires.sql](db/neon/03-paires.sql) : box, paires et inscriptions.

Pour chaque fichier, ouvrir **Raw**, copier tout le contenu, remplacer entièrement le texte de l’éditeur et cliquer sur **Run**. Vérifier que le commentaire `FIN DU FICHIER` est présent à la fin. Ne pas réutiliser une entrée d’historique marquée `QUERY TRUNCATED`.

Chaque fichier fait moins de 10 Ko, est transactionnel et répétable sans effacer les matchs existants. Le résultat du troisième doit indiquer **66 paires, 11 box et 66 inscriptions**. Le fichier complet [db/bootstrap.sql](db/bootstrap.sql) reste disponible pour les outils sans troncature de l’historique.

`npm run db:bootstrap-sql` régénère tous ces fichiers depuis les migrations et les données canoniques. Les scripts courts ont été testés sur PostgreSQL embarqué et comparés au script complet, y compris les identités, les paires et les dates du cycle. La connexion privée est ensuite enregistrée directement comme secret `DATABASE_URL` dans Cloudflare.

### Créer et préparer la base

1. Créer un projet Neon en région UE disponible, puis récupérer sa connexion PostgreSQL TLS dans un emplacement privé.
2. Fournir `DATABASE_URL` au processus local de manière sécurisée, sans la mettre dans une commande enregistrée ni dans Git. Les scripts lisent cette variable ; `.env` n'est pas chargé automatiquement.
3. Exécuter `npm run db:prepare` : migrations transactionnelles puis import répétable, sans effacer les matchs existants.
4. Pour le Worker, utiliser un rôle PostgreSQL distinct du propriétaire et limité aux tables applicatives. Le rôle de migration reste distinct.

Les variantes de noms confirmées sont traitées par `aliases.json` et une migration de fusion préservant les matchs. Toute nouvelle ambiguïté doit être vérifiée avant import ; une modification ultérieure du roster ne fusionne pas à elle seule des comptes existants.

### Créer les secrets de production

**Sans terminal :** télécharger [tools/generate-secrets.html](tools/generate-secrets.html), puis ouvrir le fichier sur son ordinateur dans un navigateur récent. Choisir et confirmer un mot de passe organisateur d’au moins 16 caractères ; l’outil génère `ADMIN_PASSWORD_HASH` sans requête réseau. Pour une première installation uniquement, cocher aussi la génération de `LINK_ENCRYPTION_KEY`. Pour mettre à jour une installation existante, garder la case décochée et conserver la clé existante. Enregistrer ces deux valeurs comme secrets dans **Cloudflare → Worker → Settings → Variables and Secrets**. Enregistrer également la chaîne de connexion Neon comme secret `DATABASE_URL`. Ne jamais transmettre ces valeurs dans une conversation. L’outil n’est pas inclus dans les fichiers publics de l’application et ne sauvegarde pas automatiquement les valeurs.

L’adresse de production configurée est `https://padel-league.fbrcls.workers.dev`. Après l’ajout des trois secrets, enregistrer/déployer les changements dans Cloudflare, puis ouvrir `/organisateur` avec le mot de passe choisi. La base doit avoir été préparée avec les trois scripts de `db/neon`.

**Avec terminal :**

```sh
npm run credentials:generate
```

Cette commande génère un mot de passe organisateur long et aléatoire dans `.local/production-admin-password.txt`, un vérificateur SHA-256 d’une valeur dérivée par PBKDF2-SHA-256 à 600 000 itérations et une clé AES-GCM dans `.local/production-secrets.json`. Elle refuse d'écraser des secrets existants. Conserver ces fichiers dans un gestionnaire de secrets ; sauvegarder la clé de chiffrement séparément de la base.

Pour un mot de passe personnalisé d'au moins 16 caractères, `npm run admin:password` reçoit le mot de passe via l'entrée standard et produit uniquement son empreinte. Rediriger cette empreinte vers un fichier privé. Éviter les arguments de commande, l'affichage et l'historique du terminal.

Se connecter avec `npx wrangler login`, puis renseigner les secrets à l'aide des invites sécurisées :

```sh
npx wrangler secret put DATABASE_URL
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put LINK_ENCRYPTION_KEY
```

Changer `ADMIN_PASSWORD_HASH` invalide les sessions organisateur. Changer la clé AES invalide la possibilité de retrouver les anciens liens chiffrés : ne pas la remplacer sans procédure de rotation et de sauvegarde.

### Déployer

1. Le namespace `CONFIRMATION_QUEUE` du compte de l’organisateur est déjà configuré. Pour un autre compte uniquement, créer un namespace avec `npx wrangler kv namespace create CONFIRMATION_QUEUE` et mettre à jour son identifiant dans `wrangler.jsonc`. Il stocke uniquement des repères d’échéance.
2. Vérifier que `APP_ORIGIN` correspond exactement à l’origine HTTPS publique, sans chemin ni barre finale. Le dépôt utilise déjà `https://padel-league.fbrcls.workers.dev`.
2. Vérifier que les trois secrets existent dans Cloudflare et que la base est préparée.
3. Exécuter `npm run deploy`. Une garde refuse l'origine d'exemple.
4. Vérifier la connexion organisateur, les paires, un score de démonstration et le Cron Trigger en conditions réelles. Aucun lien joueur n'est généré automatiquement en production : les créer depuis l'espace organisateur après ces vérifications.
5. Mesurer les quotas CPU et la connexion à Neon. La production Cloudflare refuse le calcul PBKDF2 à 600 000 itérations dans le Worker. Ce calcul est donc effectué dans le navigateur ; le Worker vérifie uniquement SHA-256 de la valeur dérivée. Le nombre d’itérations reste inchangé. Les anciens secrets `pbkdf2:600000:…` doivent être remplacés par `pbkdf2-client:600000:…`.
6. Annuler les matchs de démonstration et distribuer les liens privés.

La tâche planifiée tourne toutes les cinq minutes. Elle consulte Workers KV et ne réveille Neon que lorsqu’un repère d’échéance est arrivé, ou lors d’un rattrapage quotidien à minuit UTC. Cela évite de maintenir Neon actif en permanence. Un repère est enregistré avant la validation de chaque saisie ; en cas d’échec KV, la saisie est annulée et peut être réessayée. Elle confirme au maximum 100 résultats par passage et rattrape les suivants aux passages ultérieurs. Les pannes et quotas peuvent retarder la confirmation. L'espace organisateur affiche la dernière exécution et permet un rattrapage.

## Export et sauvegarde

```sh
npm run export
```

Crée un export métier JSON privé dans `.local/exports`, depuis la base locale ou Neon si `DATABASE_URL` est présent. L'export utilise une transaction de lecture cohérente et exclut les liens, sessions et secrets. Il ne constitue pas une sauvegarde restaurable complète.

Pour une sauvegarde complète en production, utiliser `pg_dump` avec une connexion fournie par les mécanismes sécurisés PostgreSQL, puis tester `pg_restore` dans une base séparée. Conserver la copie dans un emplacement privé indépendant de Neon et la clé AES séparément. Prévoir un export quotidien et une sauvegarde avant les migrations. La restauration sur Neon n'est pas encore vérifiée faute de compte.

## Décisions d'implémentation

- Les requêtes SQL paramétrées et migrations SQL explicites remplacent Drizzle pour cette version : cela garde les transactions et verrous lisibles sur une petite application, avec le même PostgreSQL local et distant.
- Les sessions et tentatives de connexion sont persistantes. Les droits sont vérifiés côté serveur ; les cookies sont `HttpOnly` et `Secure` en production. Les mutations contrôlent l'origine et un en-tête dédié.
- Les liens utilisent un fragment d'URL, retiré après connexion, une empreinte en base et une copie chiffrée visible uniquement par l'organisateur. Remplacer un lien révoque les sessions du joueur.
- Les corrections conservent l'historique complet ; le classement est recalculé depuis les résultats confirmés.
- Les égalités utilisent un mini-classement des matchs entre paires à égalité, puis les victoires globales (forfaits inclus), puis les jeux gagnés ; les égalités persistantes restent ex æquo.

## Avant ouverture

- Vérifier la composition des paires et la distribution des liens avec l’organisateur.
- Vérifier les offres et comptes, la région UE, le déploiement, les connexions, les quotas et la tâche automatique réelle.
- Tester une sauvegarde/restauration de production et conserver les secrets en lieu sûr.
- Faire essayer les parcours joueur et organisateur au responsable de la compétition.

Les montées/descentes, coordonnées, notifications et une interface complète de gestion restent hors périmètre.

## Diagnostic d’une erreur d’exécution

Dans Cloudflare, ouvrir **Observability → Logs** sur le Worker et reproduire le problème. Les erreurs API affichent une référence dans l’application et journalisent un objet `API error` avec la même référence, une catégorie et, pour PostgreSQL, le code `sqlstate`. Le message brut, la pile, les paramètres SQL et les secrets ne sont jamais journalisés par ce diagnostic.

- `configuration` : vérifier les noms de bindings indiqués dans les paramètres du Worker.
- `database_schema` / `42P01` : table absente ; exécuter les trois scripts de `db/neon` sur la base et la branche utilisées par `DATABASE_URL`.
- `database_authentication` / `28P01` : vérifier la connexion dans Neon → Connect et mettre à jour le secret directement dans Cloudflare.
- `database_permissions` / `42501` : vérifier les droits du rôle PostgreSQL.
- `database_connection` : vérifier la disponibilité et la connectivité Neon.

Pour vérifier la préparation sans exposer une connexion ni un mot de passe, exécuter dans Neon SQL Editor :

```sql
SELECT current_database() AS base,
       to_regclass('public.login_attempts') AS login_attempts,
       to_regclass('public.sessions') AS sessions,
       to_regclass('public.players') AS players;
```

Une valeur `NULL` indique que la table n’est pas présente dans cette base. La présence des tables dans l’éditeur ne prouve pas que le Worker pointe sur la même branche ; vérifier la sélection de Neon → Connect sans partager la chaîne privée.

### Mise à jour du secret organisateur après la limite PBKDF2 Cloudflare

Retélécharger `tools/generate-secrets.html`, saisir le même mot de passe et laisser la génération de clé décochée. Copier uniquement le nouveau `ADMIN_PASSWORD_HASH` dans Cloudflare et enregistrer/déployer. Ne pas changer `LINK_ENCRYPTION_KEY` ni `DATABASE_URL`. Actualiser la page de connexion après le déploiement du nouveau code.

La connexion récupère uniquement le sel public et les 600 000 itérations, calcule PBKDF2 dans le navigateur, puis transmet la valeur dérivée par HTTPS. Cette valeur est un credential sensible équivalent au mot de passe ; elle n’est ni sauvegardée ni journalisée. Le secret serveur contient **SHA-256 de cette valeur**, pas la valeur elle-même : connaître le vérificateur stocké ne permet pas de se connecter directement. Les essais restent limités et les sessions organisateur restent révoquées lors d’un changement de secret. Aucun ancien vérificateur PBKDF2 n’est accepté comme credential en production ; seule la base locale bénéficie d’une compatibilité pour ses accès de démonstration.

La limite du runtime est confirmée par [le contrôle officiel de workerd](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/impl.c++), qui produit `NotSupportedError` lorsque le plafond d’itérations est dépassé. Le runtime local ne reproduisait pas ce plafond de production. Les tests simulent maintenant un refus PBKDF2 serveur et vérifient que la connexion utilise uniquement le vérificateur léger.
