# PARC — inventaire du stockyard · version 0.2

Démonstrateur industriel en français : **Next.js + TypeScript + Three.js**, traitement **Python/FastAPI**, deux conteneurs Docker séparés. Il remplace le prototype initial ; ce dossier est un projet complet, pas un correctif à appliquer par-dessus.

> **Simulation uniquement.** Les commandes ne pilotent aucun automate. La carte est un fond réel fourni en ligne, mais son origine par défaut est un exemple, pas l'implantation relevée sur les photos. Les tonnages sont calculés à partir de dépôts simulés, et ne constituent pas un inventaire validé par LiDAR.

## Démarrage Docker

Prérequis : Docker avec Compose v2, accès réseau aux registres d'images et de paquets pour la première construction. Aucune installation locale de Node ou Python n'est nécessaire pour l'utilisation normale.

```bash
cd stockyard-fr-v2
cp .env.example .env
docker compose up --build
```

- Application : **http://localhost:3000**
- Documentation de l'API Python : **http://localhost:8000/docs**

Les ports sont liés à `127.0.0.1` par défaut. Le conteneur frontend et le conteneur backend utilisent un réseau Docker dédié. Les acquisitions et corrections sont conservées dans le volume `stockyard-data` ; aucune base de données supplémentaire n'est nécessaire pour ce démonstrateur.

```bash
# Démarrage en arrière-plan
docker compose up --build -d
# État et journaux
docker compose ps
docker compose logs -f backend
# Arrêter les services sans supprimer les acquisitions
docker compose down
```

**Ne pas ajouter `-v` à la dernière commande** sauf décision explicite de supprimer le volume et son historique. Après un redémarrage du backend, l'état est restauré mais le stacker reste à l'arrêt. Un clic sur Démarrer est nécessaire.

### État réel de la vérification de cette livraison

39 tests Python ont été exécutés avec succès dans l'environnement de préparation. La syntaxe de 17 fichiers TypeScript/TSX et celle des fichiers YAML ont également été vérifiées. **La construction Next.js, les images Docker et les tests navigateur n'ont pas été exécutés ici** : Docker et les dépendances frontend ne sont pas disponibles, et le réseau de cet environnement ne permet pas leur installation. Voir `docs/VALIDATION.md` et les commandes de recette ci-dessous.

## Parc vide → dépôt → sélection

1. Au premier lancement, aucun stock n'est préchargé. Sur une session déjà utilisée, cliquer **Parc vide**, puis **Confirmer le parc vide**. Cela ouvre une nouvelle session et conserve le journal précédent sur le serveur.
2. Cliquer **Démarrer** dans Pilotage, ou **Démarrer la simulation** dans le viewport. Le stacker translate sur le rail, sa flèche et son scanner suivent la chaîne cinématique. La matière est ajoutée progressivement et les balayages mesurent la surface générée.
3. Laisser tourner environ **40 à 60 secondes** pour observer plusieurs passages avec les réglages par défaut. Le temps est accéléré ×300. Les produits alternent à chaque passage ; le côté de stockage alterne à chaque aller-retour. Ces automatismes sont désactivables.
4. Cliquer **Arrêter**. Le déplacement et l'acquisition simulée s'arrêtent. Le stock demeure visible. Un éventuel rattrapage déjà en attente peut continuer indépendamment.
5. Passer en **Vue 2D**, cliquer **Intervalle**, choisir **Parc sud**, **Parc nord** ou **Les deux parcs**, puis cliquer-glisser sur la carte. Les marqueurs jaunes indiquent les bornes en mètres. **Rectangle** permet de limiter aussi l'emprise latérale.
6. Le tableau sous la vue affiche les produits et tonnages présents dans cette sélection, et non le stock total du parc. Les champs **De / à** permettent également de saisir des limites numériques exactes. **Tout le parc** annule le filtre spatial.
7. Consulter **Par produit**, **Lots & dépôts** ou **Qualité & traçabilité**, puis **Exporter CSV** pour conserver la sélection.

La sélection fonctionne pendant le dépôt, à l'arrêt et en relecture. Les valeurs sont calculées par le serveur, pas par lecture des pixels ni par une règle de trois sur la longueur totale du tas.

## Ce que contient le tableau

Tonnage, volume, densité effective, BPL, CO₂, MgO, SiO₂, CaO, humidité, produit, lot, nombre de dépôts, première et dernière acquisition du lot, statut simulé. Le panneau de traçabilité ajoute l'instance d'acquisition, machine/scanner, couverture des cellules occupées, volume LiDAR observé partiel, hauteur maximale et méthode.

Les analyses et densités sont **fictives**. Elles sont figées dans chaque dépôt et pondérées par la masse lors des agrégations. Modifier la fiche produit ne réécrit pas les dépôts passés. Une densité modifiée vaut pour les dépôts suivants.

### Deux résultats différents, volontairement séparés

- **Stock modélisé** : bilan des dépôts simulés, spatialisés sur des cellules de 2 × 2 m. Pour chaque cellule, volume × densité enregistrée donne la masse ; une cellule partiellement sélectionnée contribue au prorata exact de l'aire intersectée. La distribution est supposée uniforme à l'intérieur d'une cellule.
- **Surface LiDAR observée** : dernières mesures valides par cellule. Elle est partielle et conserve des zones inconnues. Son intégrale n'est ni une reconstruction certifiée ni un inventaire global. Aucun remplissage silencieux des zones non scannées n'est effectué.

La couleur du maillage indique le produit dominant **en volume** dans la cellule. Elle ne prouve pas la composition chimique ni l'ordre réel des couches. Le tableau conserve les contributions de tous les produits mélangés. Le maillage 3D lisse les sommets pour l'affichage ; les calculs utilisent la grille conservatrice, pas ce maillage lissé.

## Commandes et paramètres

**Pilotage / Paramètres / Machine** : translation minimale/maximale, vitesse, débit, accélération temporelle, orientation, inclinaison, oscillation, longueur de flèche, hauteur de pivot, largeur de dépôt, produit, côté et alternance. Les dimensions majeures du modèle sont configurables ; la charpente de détail reste un modèle procédural illustratif, pas une maquette constructeur.

**Paramètres / Scanner** : marche de l'acquisition, fréquence, nombre de rayons, champ de vision, portée, bruit, taux de retours absents, biais/échelle de distance, seuil de qualité, limites Z, translations et rotations de montage.

**Paramètres / Produits & qualité** : noms, couleurs, densités et analyses de démonstration. Les nouvelles valeurs s'appliquent aux dépôts à venir. Les paramètres et motifs sont journalisés.

**Scanner / Mesures & corrections** : lire un balayage précis, voir les distances et qualités brutes, éditer une copie de travail, exclure un retour, exporter le brut ou importer des corrections JSON. Un opérateur et un motif sont obligatoires. L'application ne permet pas de changer l'identité ou l'horodatage d'une acquisition. Voir `docs/CORRECTIONS-SCANNER.md`.

## Fond cartographique réel et implantation

Le backend fournit un manifeste de tuiles satellitaires HTTPS. Three.js affiche ces images comme sol plat, sous les rails et les dépôts. La géométrie des tuiles est calculée en Python à partir de WGS84, puis du repère métrique local. Le navigateur ne choisit pas librement un hôte cartographique ni des coordonnées de tuiles arbitraires.

Le modèle de service fourni est `Esri World Imagery`. **Aucune image satellite n'est intégrée dans l'archive**, et son accessibilité n'a pas pu être vérifiée depuis l'environnement de préparation. Il faut un accès réseau sortant et des droits d'utilisation compatibles avec le fournisseur retenu. L'attribution reste affichée. Vérifier les conditions et éventuelles exigences d'authentification avant un déploiement ; le modèle d'URL n'est pas une licence commerciale.

Si les tuiles ne chargent pas, la vue reste utilisable avec un sol de repli et un message explicite. Ce repli est un schéma, pas une fausse image satellite.

### Paramétrer le site

Avant la première session, configurer dans `.env` :

```dotenv
SITE_NAME=Mon parc de stockage
SITE_ORIGIN_LAT=33.110
SITE_ORIGIN_LON=-8.610
SITE_ORIGIN_ALT_M=0
SITE_HEADING_DEG=0
```

**Ces nombres sont un exemple**, pas les coordonnées identifiées sur les captures. Les deux premières variables sont la latitude/longitude WGS84 de l'origine des rails. L'altitude est ellipsoïdale WGS84. `SITE_HEADING_DEG` est l'angle du +X du parc, antihoraire depuis l'Est géographique : 0° = Est, 90° = Nord. Il ne s'agit pas d'un azimut horaire depuis le Nord.

Après la création du journal, sa configuration persistante est prioritaire sur les variables d'initialisation. Pour changer le repère, arrêter, créer un **Parc vide**, puis utiliser **Paramètres → Carte & repère**. Le backend refuse de déplacer géographiquement un stock déjà acquis.

Le fournisseur peut être remplacé dans `.env` avec `MAP_TILE_URL` et `MAP_ATTRIBUTION`. Le modèle d'URL doit servir des tuiles **XYZ Web Mercator** et accepter `{z}`, `{x}`, `{y}` ; un service TMS avec Y inversé doit être adapté. `MAP_ENABLED=false` permet une démonstration volontairement sans imagerie. Ne pas placer de secret fournisseur dans le code frontend.

L'implantation des rails est synthétique, longue de 360 m. Une vraie orthophoto/DEM, le datum altimétrique, l'origine et les points relevés des rails sont encore nécessaires pour reproduire exactement le site photographié. La version livrée n'importe pas encore de GeoTIFF ni de terrain altimétrique.

## Communication, rattrapage et relecture

Le bouton **Communication et journal** ouvre un simulateur de coupure entre acquisition et central. Durant une coupure, l'acquisition et le journal brut continuent ; le stock central et les poses reçues restent figés. Les acquisitions manquantes sont comptées par identité, pas par une durée supposée.

À la restauration, les nouvelles acquisitions passent en direct et les anciennes sont acceptées en parallèle, sans double comptage. **Liaison rétablie ne signifie pas stock réconcilié** : le statut reste « rattrapage en cours » jusqu'à réception de tous les identifiants en attente. Le navigateur reste relié au central ; ce test ne coupe pas son WebSocket. Une vraie coupure navigateur déclenche séparément la reconnexion automatique et le badge de données figées.

Le curseur **Relecture** restitue la géométrie à une séquence antérieure de la session courante, avec la pose et le montage acquis. Les commandes de pilotage sont indisponibles dans cette vue. **Revenir en direct** retrouve l'état courant. Les corrections actuellement acceptées s'appliquent aussi à la relecture ; ce n'est pas encore une relecture bitemporelle « tel que connu à l'époque ».

Les anciennes sessions sont conservées dans le journal, mais leur sélection depuis l'interface n'est pas encore disponible. Le journal est un mécanisme local de démonstration, non une implémentation distribuée de MACHINE_EDGE et PRIMARY_EDGE.

## Recette et développement

```bash
# Tests Python dans une image dédiée de test (pas de 3e service applicatif permanent)
docker build --target test -t parc-backend-test ./backend
docker run --rm parc-backend-test

# Vérification des deux services
docker compose config --quiet
docker compose up --build -d --wait
```

Sur une machine disposant également de Node 22 :

```bash
cd frontend
npm install
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Les tests navigateur nécessitent les deux services démarrés. Ils créent une session vide : les exécuter sur une instance de recette, pas sur une démonstration à conserver à l'écran. `E2E_URL` et `E2E_API_URL` permettent des ports différents.

Le premier `npm install` génère un `package-lock.json`. Le conserver dans le dépôt après résolution réussie. Le Dockerfile utilise `npm ci` lorsqu'il est présent, sinon `npm install`. Aucun faux fichier de verrouillage n'a été fabriqué dans cette livraison. Les versions principales sont fixées dans `package.json`, mais les dépendances transitives ne sont pas encore verrouillées.

Rechargement à chaud optionnel :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

L'override de développement monte les sources et utilise les permissions de la cible de construction frontend pour les volumes Node. Les **images d'exécution normales** des deux services utilisent un utilisateur non privilégié.

## Arborescence

```text
backend/app/
  models.py       Modèles validés, unités, paramètres et produits
  geometry.py     Repères, chaîne cinématique, traitement LiDAR, géoréférence
  inventory.py    Grille, conservation de matière, intersections, agrégations
  journal.py      Journal JSONL append-only, flush/fsync, reprise
  engine.py       Simulation, acceptation, déduplication, relecture et corrections
  main.py         API, horloge d'acquisition, WebSocket et proxy de carte
backend/tests/    39 tests de calcul et d'API
frontend/app/     Next.js App Router, français, configuration runtime
frontend/three/  Scène, caméra 2D/3D, machine, scanner, carte, sélection
frontend/components/  Pilotage, inventaire, scanner, paramètres et diagnostic
frontend/lib/    Contrats internes, client API, synchronisation d'affichage
frontend/tests/  Scénarios Playwright fournis, non exécutés ici
scripts/         Contrôles et recette locale
.github/workflows/ci.yml  Recette Python + Docker + navigateur
```

## Limites à conserver visibles

L'app n'est ni un système de sécurité ni une commande de production. Il reste à réaliser l'authentification/RBAC, TLS, la gouvernance des corrections, les pilotes matériels, l'interpolation de poses PLC asynchrones, la synchronisation d'horloges, les Edge distribués avec ACK de garde, la rétention et le stockage volumineux, la reconstruction validée du stock et les contrôles métrologiques. La simulation connaît la pose exacte à chaque acquisition ; elle ne démontre pas encore l'interpolation de deux flux matériels séparés.

La session est volontairement bornée à 12 000 acquisitions et une hauteur modélisée de 18 m. Ces seuils sont des garde-fous du démonstrateur, pas des limites physiques de votre installation. Seul un processus Uvicorn doit exécuter cette horloge locale ; ne pas augmenter le nombre de workers pour cette version.

Aucun port industriel, registre d'automate, pilote scanner ou protocole matériel n'a été inventé. Les contrats JSON et le journal de ce projet sont des formats internes provisoires.


## Mise à jour v2.1 — Jobs de simulation

Cette archive inclut la couche **Simulation** : création de jobs, paramétrage des
distances, vitesses, débits, types de stockage et passages produits. Les stocks
sont colorés selon les produits déposés et chaque job affiche ses résultats
(tonnage, volume, hauteur maximale, durée, répartition par produit).

Pour tester : ouvrez l'application, allez dans **Simulation**, configurez un
scénario, puis cliquez sur **Créer et lancer**. Dupliquez ensuite le job pour
comparer l'effet d'un changement de paramètre.

Voir `docs/CHANGEMENTS_SIMULATION_JOBS.md` pour le résumé de la mise à jour.


## Mise à jour v2.2 — Surface de stock propre

La vue 3D affiche maintenant le produit avec une surface plus continue. Les points scanner sont conservés comme couche de diagnostic (`Points scanner (debug)`) mais ils sont désactivés par défaut pour éviter l’effet pixellisé pendant la présentation. Le calcul du tonnage et du volume reste inchangé côté backend Python.
