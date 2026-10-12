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

### Créer et préparer la base

1. Créer un projet Neon en région UE disponible, puis récupérer sa connexion PostgreSQL TLS dans un emplacement privé.
2. Fournir `DATABASE_URL` au processus local de manière sécurisée, sans la mettre dans une commande enregistrée ni dans Git. Les scripts lisent cette variable ; `.env` n'est pas chargé automatiquement.
3. Exécuter `npm run db:prepare` : migrations transactionnelles puis import répétable, sans effacer les matchs existants.
4. Pour le Worker, utiliser un rôle PostgreSQL distinct du propriétaire et limité aux tables applicatives. Le rôle de migration reste distinct.

Les variantes de noms confirmées sont traitées par `aliases.json` et une migration de fusion préservant les matchs. Toute nouvelle ambiguïté doit être vérifiée avant import ; une modification ultérieure du roster ne fusionne pas à elle seule des comptes existants.

### Créer les secrets de production

```sh
npm run credentials:generate
```

Cette commande génère un mot de passe organisateur long et aléatoire dans `.local/production-admin-password.txt`, une empreinte PBKDF2-SHA-256 à 600 000 itérations et une clé AES-GCM dans `.local/production-secrets.json`. Elle refuse d'écraser des secrets existants. Conserver ces fichiers dans un gestionnaire de secrets ; sauvegarder la clé de chiffrement séparément de la base.

Pour un mot de passe personnalisé d'au moins 16 caractères, `npm run admin:password` reçoit le mot de passe via l'entrée standard et produit uniquement son empreinte. Rediriger cette empreinte vers un fichier privé. Éviter les arguments de commande, l'affichage et l'historique du terminal.

Se connecter avec `npx wrangler login`, puis renseigner les secrets à l'aide des invites sécurisées :

```sh
npx wrangler secret put DATABASE_URL
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put LINK_ENCRYPTION_KEY
```

Changer `ADMIN_PASSWORD_HASH` invalide les sessions organisateur. Changer la clé AES invalide la possibilité de retrouver les anciens liens chiffrés : ne pas la remplacer sans procédure de rotation et de sauvegarde.

### Déployer

1. Créer un namespace avec `npx wrangler kv namespace create CONFIRMATION_QUEUE` puis remplacer l’identifiant fictif de `kv_namespaces` dans `wrangler.jsonc`. Ce namespace stocke uniquement des repères d’échéance, jamais de données joueurs.
2. Remplacer `REPLACE` dans `wrangler.jsonc` par le sous-domaine du compte, et vérifier que `APP_ORIGIN` est exactement l'origine HTTPS publique, sans chemin ni barre finale.
2. Vérifier que les trois secrets existent dans Cloudflare et que la base est préparée.
3. Exécuter `npm run deploy`. Une garde refuse l'origine d'exemple.
4. Vérifier la connexion organisateur, les paires, un score de démonstration et le Cron Trigger en conditions réelles. Aucun lien joueur n'est généré automatiquement en production : les créer depuis l'espace organisateur après ces vérifications.
5. Mesurer les quotas CPU et la connexion à Neon. PBKDF2 a été vérifié dans le runtime Workers **local**, pas sur les quotas du compte gratuit distant. Si un quota empêche l'authentification, résoudre ce point avant ouverture, sans diminuer la sécurité silencieusement.
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
