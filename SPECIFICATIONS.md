# Padel League La Cure — Spécifications fonctionnelles

Ce document rassemble les décisions prises avec l'organisateur pour la première version de l'application. Les règles précisées ici prévalent sur les documents initiaux lorsqu'elles les actualisent.

## 1. Objectif et périmètre

Permettre aux joueurs d'une compétition amicale de programmer leurs matchs, d'encoder facilement les scores et de consulter les résultats et le classement de leur box.

La priorité est une première version rapidement opérationnelle. L'application est une application web en français, adaptée aux téléphones et aux navigateurs sur ordinateur.

## 2. Organisation de la compétition

- Premier cycle : du **12 octobre au 29 novembre 2026 inclus**, heure belge (`Europe/Brussels`).
- Deux tableaux : **Open/Messieurs** et **Dames/Mixtes**.
- Composition initiale : **66 paires dans 11 box** — 31 paires dans les 5 box Open/Messieurs, 35 paires dans les 6 box Dames/Mixtes.
- La box 1 correspond au niveau le plus élevé.
- Les paires sont fixes pendant le cycle. Le règlement autorise un remplacement pour blessure par un joueur de classement équivalent, avec accord préalable de l'organisation ; sa gestion reste manuelle pour cette version.
- Chaque paire peut jouer un nombre illimité de matchs contre les autres paires de sa box.
- Plusieurs matchs contre la même paire sont autorisés et comptent tous au classement.
- Il n'est pas obligatoire de rencontrer toutes les paires de sa box.

### Sources de la composition initiale

- `Padel_League_Final_mise_en_forme.pdf` : tableau Open/Messieurs.
- `Padel League Final Femme.pdf` : tableau Dames/Mixtes.
- `Règlement_Padel_League_La_Cure.pdf` : règlement initial, complété et actualisé par les décisions consignées ici.

Ces fichiers ont été fournis dans la conversation ; leur présence dans le dépôt n'est pas supposée.

## 3. Joueurs, paires et accès

- Chaque personne reçoit un **lien personnel sans mot de passe**.
- Un joueur peut appartenir à plusieurs paires, y compris dans plusieurs box ou tableaux.
- Son lien unique donne accès à toutes ses paires et aux box correspondantes.
- L’organisateur a confirmé les identités « Fred Romain / Frédéric Romain », « Kevin Tulpinck / Kevin Tulpinckx » et les deux inscriptions « Manon ». Chacune utilise un seul accès personnel pour toutes ses paires.
- Les liens doivent être privés, non devinables et remplaçables par l'organisateur en cas de divulgation.
- Les coordonnées personnelles seront fournies ultérieurement. Elles ne sont pas nécessaires au lancement : l'organisateur distribue lui-même les liens.
- Un joueur peut agir sur les matchs de ses paires et consulter les matchs et classements des box auxquelles il participe.

## 4. Programmation des matchs

N'importe lequel des quatre joueurs peut enregistrer un match en sélectionnant :

1. Sa paire.
2. Une paire adverse de la même box.
3. Une date et une heure pendant le cycle.

La date est convenue entre les joueurs en dehors de l'application. Son enregistrement ne nécessite pas d'acceptation dans l'application.

La réservation du terrain reste effectuée séparément dans SportFinder. L'application ne réserve aucun terrain et ne gère aucun paiement.

Un match joué peut aussi être encodé directement sans programmation préalable, avec sa date et son heure.

## 5. Format des matchs et encodage

- Un match dure **1 h 30**.
- Les jeux sont comptés en continu : il n'y a pas de sets.
- Le résultat est composé de deux nombres entiers positifs ou nuls, par exemple **18–9**.
- Le score le plus élevé désigne le vainqueur ; deux scores égaux donnent un match nul.
- N'importe lequel des quatre joueurs peut encoder le résultat.
- Un forfait doit être identifié séparément d'un match joué ; il ne doit pas être transformé en score fictif.
- L'interface doit rendre explicite la paire à laquelle chaque score est attribué.

## 6. Confirmation et contestation

### États du match

- **Programmé** : date enregistrée, sans résultat.
- **En attente** : résultat encodé, non confirmé.
- **Confirmé** : résultat validé, pris en compte dans le classement.
- **Contesté** : résultat contesté, exclu du classement jusqu'à résolution.
- **Annulé** : match ou doublon annulé, exclu du classement.

### Règles de validation

- Après encodage, le résultat est en attente.
- Un des deux joueurs de la paire adverse à celle de l'auteur de l'encodage peut le confirmer.
- Sans contestation, la confirmation devient automatique **48 heures après l'encodage**.
- Un adversaire peut contester le résultat pendant ce délai et proposer un score corrigé.
- Une contestation suspend la confirmation automatique.
- L'organisateur tranche si nécessaire et valide le résultat retenu.
- Les résultats en attente et contestés restent visibles avec leur statut.
- Seuls les résultats confirmés alimentent le classement.
- La confirmation automatique doit fonctionner sans dépendre de l'ouverture de l'application par un joueur.

La première version ne prévoit pas de notifications automatiques : les joueurs consultent les résultats à confirmer via leur lien.

## 7. Points et classement

### Attribution des points

| Résultat | Points par équipe |
| --- | ---: |
| Victoire jouée : 3 points + bonus de participation | 4 |
| Match nul : 1 point + bonus de participation | 2 |
| Défaite jouée : bonus de participation | 1 |
| Équipe déclarée forfait | 0 |
| Adversaire d'une équipe déclarée forfait | 3 |

Le bonus de participation ne s'applique pas à un forfait. Tous les matchs confirmés comptent, sans limite, y compris les rencontres répétées contre une même paire. Le fait que les équipes jouant davantage puissent accumuler davantage de points est voulu par l'organisateur.

### Ordre des critères

1. Total des points.
2. Confrontations directes.
3. Nombre total de victoires.
4. Nombre total de jeux gagnés.

Les confrontations directes comparent les points cumulés des matchs entre les paires à égalité. Pour trois paires ou plus, établir un mini-classement des rencontres entre elles, puis utiliser les victoires globales et les jeux gagnés globaux sans recalculer un nouveau mini-classement pour les sous-groupes.

Si tous les critères restent identiques, afficher les paires ex æquo.

Ces critères remplacent le différentiel de jeux et le tirage au sort prévus par le règlement initial.

### Informations affichées

Pour chaque paire : rang, joueurs, matchs joués confirmés, victoires, nuls, défaites, jeux gagnés, jeux perdus, différentiel de jeux et total des points. Le différentiel est informatif et n'intervient pas dans le départage.

Les forfaits sont distingués des matchs effectivement joués. Une victoire par forfait compte dans le nombre total de victoires pour le départage, sans jeux gagnés ou perdus fictifs.

## 8. Parcours et écrans de lancement

### Accueil personnel

- Paires du joueur et accès aux box correspondantes.
- Matchs programmés.
- Résultats en attente de confirmation.
- Actions principales : programmer un match et encoder un résultat.

### Box

- Classement.
- Matchs programmés.
- Matchs joués et résultats, avec leurs statuts.
- Accès aux actions sur les matchs auxquels le joueur participe.

### Encodage et validation

- Sélection des paires et de la date si le match n'a pas été programmé.
- Saisie des deux scores ou déclaration d'un forfait.
- Récapitulatif des paires et du résultat avant soumission.
- Confirmation ou contestation pour les adversaires.

## 9. Accès organisateur minimal

L'organisateur dispose d'un accès privé permettant de :

- Consulter tous les matchs et classements.
- Consulter et distribuer les liens personnels ; remplacer un lien si nécessaire.
- Corriger ou valider un résultat.
- Résoudre une contestation.
- Annuler un match ou un doublon.

La préparation initiale des joueurs, paires et box peut être effectuée sans interface de gestion complète. Les corrections doivent conserver une trace de l'auteur, de la date et du changement effectué pour permettre de comprendre un résultat litigieux.

## 10. Présentation et données personnelles

- Interface en français, lisible sur petit écran, avec de grands boutons et des formulaires courts.
- Direction visuelle issue de l'affiche fournie : bleu marine, jaune et blanc, identité Padel League La Cure.
- Les liens personnels ne doivent pas être accessibles dans une liste publique.
- Les coordonnées personnelles seront ajoutées dans une version ultérieure et accessibles uniquement aux participants de la box concernée, pour organiser les rencontres, conformément au règlement.
- Les futures fonctionnalités devront permettre de traiter les demandes d'accès, de rectification et d'effacement auprès de l'organisation.

## 11. Fonctionnalités reportées

- Affichage des coordonnées des adversaires.
- Notifications automatiques et rappels.
- Gestion complète des inscriptions, joueurs, paires, box et cycles.
- Automatisation des montées et descentes.
- Intégration de réservation ou de paiement avec SportFinder.

Le règlement initial prévoit deux montées et deux descentes par box, avec les exceptions aux box extrêmes. Leur automatisation et les détails du traitement de fin de cycle ne font pas partie de la première version.

## 12. Vérifications attendues avant ouverture

1. Un lien personnel donne accès à toutes les paires du joueur, sans permettre d'agir sur les matchs d'autres paires.
2. Un joueur programme un match contre une paire de sa box.
3. Un joueur encode un match non programmé et peut rejouer contre un adversaire déjà rencontré.
4. Pour un résultat **18–9**, le classement ne change pas avant confirmation ; après confirmation, les équipes reçoivent respectivement **4 et 1 points**, avec leurs jeux gagnés et perdus.
5. Un résultat égal attribue **2 points à chaque équipe** après confirmation.
6. Sans intervention, un résultat devient confirmé après 48 heures et met à jour le classement.
7. Une contestation suspend la confirmation automatique et permet une résolution par l'organisateur.
8. Un forfait attribue **0 et 3 points**, sans bonus ni score fictif.
9. Un doublon annulé ne compte pas au classement.
10. Le classement applique les critères de départage dans l'ordre convenu.
11. Les parcours de programmation, encodage et confirmation sont utilisables sur téléphone et ordinateur.

## 13. Clôture du cycle

- Les matchs doivent avoir été joués du 12 octobre au 29 novembre 2026 inclus, heure belge.
- La saisie des résultats est autorisée jusqu’au **1er décembre 2026 à 23 h 59**, heure belge.
- Les confirmations automatiques et les contestations déjà ouvertes continuent ensuite jusqu’à résolution.
- Le classement définitif peut être arrêté une fois tous les résultats traités ; aucune clôture automatique ne doit masquer une contestation en cours.
