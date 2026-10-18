# Recette manuelle du démonstrateur

À effectuer sur une instance de test. Les actions « Parc vide » ouvrent une nouvelle session ; les anciennes acquisitions restent dans le journal.

| Scénario | Action | Résultat attendu |
|---|---|---|
| Initialisation | Premier démarrage, journal absent | Parc sans stock, machine arrêtée, zéro tonne |
| Dépôt | Démarrer | Translation, acquisition et stock progressent ; aucun bouton n'envoie d'ordre industriel |
| Aller-retour | Attendre les limites de translation | Inversion de direction ; nouveaux produits/lot selon configuration |
| Arrêt | Arrêter, liaison réconciliée | Pose et séquence cessent d'avancer, tonnage stable |
| Deux dimensions | Vue 2D | Projection orthographique, nord géographique indiqué, sol non incliné |
| Intervalle | Intervalle, cliquer-glisser | Deux bornes jaunes, panneau et tableau limités à la sélection |
| Rectangle | Rectangle, glisser sur un seul parc | Le stock de l'autre parc est exclu |
| Découpe de cellule | Saisir 31,3 à 70,7 m | Calcul proratisé aux limites, sans arrondi à une cellule entière |
| Zone vide | Sélectionner une zone non déposée | Zéro tonne et aucune ligne produit |
| Produits superposés | Déposer différents produits au même endroit | Tableau avec plusieurs contributions même si une couleur domine |
| Export | Exporter CSV | UTF-8 avec BOM, séparateur point-virgule, données de la sélection courante |
| Scanner arrêté | Désactiver l'acquisition du scanner | Le dépôt continue, les mesures n'avancent plus |
| Correction | Exclure un rayon avec motif | Révision auditée, brut identique, grille observée recalculée ; masse du dépôt inchangée |
| Densité | Changer après quelques dépôts | Nouveaux dépôts avec nouvelle densité ; anciens volumes non réécrits |
| Carte indisponible | MAP_ENABLED=false | Vue schématique explicitement indiquée, sélection encore utilisable |
| Coupure Edge simulée | Couper la liaison et laisser tourner | Acquisition continue, tampon augmente, état central figé |
| Restauration | Rétablir la liaison | DIRECT et rattrapage concurrents ; continuité seulement après vidage exact |
| Relecture | Déplacer le curseur sur une ancienne séquence | Stock/pose antérieurs, pilotage non disponible, retour direct possible |
| Redémarrage | Relancer le backend | Stock et révisions restaurés, machine arrêtée |
| Plusieurs navigateurs | Ouvrir un second onglet | Même session et progression, pas de dépôt doublé |

## Contrôle numérique de base

Avec les réglages livrés, le débit vaut 1 800 t/h et chaque tick représente `0,1 × 300 = 30` secondes simulées. La masse ajoutée par tick est donc `1 800 / 3 600 × 30 = 15 t`. Après N acquisitions contenant un dépôt, sans changement de débit et après réconciliation, le stock vaut `15 × N t` à la précision flottante près.

La durée murale observée peut varier avec la charge ; utiliser la séquence pour ce contrôle, pas une promesse de chronométrage industriel. Arrêter avec un tampon vide avant de comparer les totaux. Deux sélections disjointes partageant l'emprise doivent sommer au total ; les différences d'affichage inférieures à 0,1 t proviennent de l'arrondi visuel, pas du moteur de calcul.
