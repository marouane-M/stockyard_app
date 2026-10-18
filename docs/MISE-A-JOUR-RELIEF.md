# Mise à jour incrémentale de v2 — croissance du relief

Cette modification part des fichiers de `stockyard-fr-v2.zip` fournis dans la
conversation. Elle ne remplace ni l'application ni son architecture. Les images
Docker, les versions de dépendances, le réseau, les ports, `.env`, le journal et
les mécanismes de sélection restent ceux de v2.

## Résultat

Le convoyeur dépose progressivement un tas en relief. Au premier passage, des
petits monticules se rejoignent en une crête. Un nouveau passage sur le même
endroit ajoute de la hauteur et élargit le tas. La masse ajoutée provient toujours
du débit et du temps simulé ; la densité détermine son volume.

Dans **Vue 3D**, le sommet de chaque cellule conserve sa hauteur modélisée, au lieu
d'être affiché uniquement par une moyenne des coins qui aplatissait les petits
tas. Les flancs se rejoignent et s'éclairent avec leurs normales mises à jour.
Les surfaces reçues s'interpolent pendant 280 ms en direct, sans prédiction.
À l'arrêt ou en relecture, la surface reçue est appliquée immédiatement.

**Hauteur max.** indique le maximum de la grille du parc, en mètres.
**Voir le relief** rapproche la caméra d'un sommet. **Recentrer** retrouve la vue
originale. Il n'y a pas d'exagération verticale. L'offset d'affichage de 0,025 m
préexistant évite seulement le conflit de profondeur avec le sol.

Le flux visuel tombe sur le triangle effectivement affiché, même pendant sa
croissance. Aucun flux visuel n'est émis lorsque le débit est nul.

## Réglages français

Dans **Paramètres → Machine** :

- **Formation du stock → Tas progressif — relief conique** est le nouveau défaut.
- **Angle du talus simulé** règle la pente géométrique, de 20° à 45°, défaut 34°.
- **Dispersion large — ancien modèle v2** conserve l'ancien calcul gaussien et son
  réglage sigma ; ce réglage n'est pas utilisé par le modèle conique.

L'angle par défaut est un paramètre illustratif, pas une mesure du phosphate ni
une recommandation de sécurité. Il s'agit d'un modèle géométrique de démonstration,
non d'un solveur d'écoulement granulaire : pas de compaction, ségrégation,
avalanche, érosion ou validation métrologique. Les garde-fous de hauteur et
capacité de session de v2 sont inchangés.

Une diminution de vitesse, un débit plus grand ou des passages répétés sur un
intervalle plus court accroissent le relief. L'accélération temporelle affecte
le déplacement ET le débit, comme auparavant ; elle ne multiplie pas la hauteur.

## Méthode conservatrice

Pour chaque nouvelle acquisition, Python recherche la hauteur d'un cône H telle
que la somme suivante corresponde exactement au volume à ajouter :

```text
volume ajouté = masse ajoutée / densité enregistrée
variation de hauteur i = max(H - tan(angle) × distance_i - hauteur_actuelle_i, 0)
somme(variation de hauteur i × aire de cellule) = volume ajouté
```

Le calcul est borné au parc de stockage choisi. L'algorithme ajoute uniquement des
contributions positives. Il ne supprime ni ne déplace un dépôt déjà acquis.
L'enveloppe conique est résolue par ensemble actif déterministe sur la grille.
Chaque acquisition conserve ses contributions par cellule et ses paramètres.

Pendant une coupure, les acquisitions utilisent la grille de l'acquisition,
qui continue à évoluer, et non la copie figée du central. Le rattrapage intègre
ensuite les incréments journalisés. Il ne rejoue pas le modèle de formation dans
un ordre d'arrivée différent.

Le maillage est destiné à l'affichage : les coins sont lissés et une bordure
retombe sur le sol, sur une largeur pouvant atteindre une cellule supplémentaire.
Son intégrale géométrique n'est pas le volume d'inventaire. Comme en v2, le bilan
matière et la sélection spatiale utilisent les cellules conservatrices de 2 m.

## Compatibilité et conservation de l'existant

Les anciens journaux, dépôts et corrections sont relus sans les recalculer.
Les deux nouveaux champs de configuration sont facultatifs à la lecture des
anciens enregistrements et prennent leurs valeurs par défaut. Les nouveaux dépôts
utilisent le modèle conique, sauf choix explicite de l'ancien modèle. Un réglage
nouveau n'a aucun effet rétroactif sur la forme ou la masse des anciens dépôts.

Le stock existant ne devient donc pas instantanément une montagne. Un nouveau
passage construit dessus. **Parc vide** reste une action volontaire confirmée ;
elle n'est pas nécessaire à l'installation. Aucun volume Docker n'est supprimé.

Le scanner continue à mesurer la grille simulée, avec la pose acquise. Les
mesures brutes/corrigées restent distinctes du tonnage du journal de dépôts.
La vue 2D, les tableaux, les produits, les lots, les densités et les intersections
partielles utilisent leurs fonctions existantes, inchangées.

## Vérification de cette modification

Les résultats actuels sont dans le rapport de validation inclus dans l'archive
incrémentale. Les anciens `docs/VALIDATION.md` et README de v2 restent des documents
de la livraison initiale, pas le rapport d'exécution de ce correctif.

Tests à réexécuter sur une instance de recette :

```bash
# Depuis la racine, dans les conteneurs d'outillage existants.
docker build --target test -t parc-backend-test ./backend
docker run --rm parc-backend-test

# Avec les dépendances frontend installées :
node scripts/test-stockpile-geometry.cjs
cd frontend
npm run typecheck
npm run build
npm run test:e2e
```

Le nouveau scénario `frontend/tests/relief.spec.ts` vérifie la hauteur réellement
présente dans le tampon de sommets du canvas, l'augmentation après un retour,
l'arrêt, le bouton de rapprochement et le retour en 2D. Il réinitialise la session
sur l'instance de recette, comme les scénarios existants : ne pas l'exécuter sur
une démonstration dont le stock doit être conservé.

Références API consultées pour les mises à jour de géométrie : documentation
Three.js `BufferGeometry` (normales, volumes englobants, drawRange) et
`BufferAttribute` (DynamicDrawUsage, needsUpdate). Les dépendances de v2 ne sont
pas mises à niveau par ce correctif.
