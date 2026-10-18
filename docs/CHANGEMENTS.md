# Changements depuis le prototype initial

- Interface applicative française, organisation proche des vues 3D et en plan des références.
- Dépôt progressif sur parc initialement vide, marche/arrêt, aller-retour, produits/lot et côtés alternés.
- Vue orthographique 2D, intervalle ou rectangle à la souris, saisie numérique et tableau spatial en dessous.
- Calcul Python de masse/volume par produit et lot, analyses et densités archivées, CSV français.
- Géoréférence WGS84 locale et couche d'imagerie HTTPS configurable ; origine d'exemple explicitement indiquée.
- Réglages du scanner, inspection de chaque rayon, données brutes conservées, corrections versionnées et import JSON de révisions.
- Volume LiDAR partiel et couverture distincts du bilan de dépôts.
- Simulation de coupure, tampon journalisé, direct + rattrapage, déduplication et contrôle d'identités pour la continuité.
- Relecture de séquences de la session actuelle, reprise sur journal persistant, arrêt systématique après redémarrage.
- Images Docker applicatives séparées, utilisateur non privilégié, portage local par défaut, configuration runtime du frontend.
- Tests Python exécutés, recette serveur locale exécutée, scénarios navigateur et CI fournis mais non exécutés dans cet environnement.

Ce projet reste un démonstrateur de développement. Il ne remplace pas les étapes de validation matérielle, de contrôle d'accès, de métrologie et de mise en production décrites dans le README.
