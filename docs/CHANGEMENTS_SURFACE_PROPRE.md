# Mise à jour v2.2 — Surface de stock propre

Cette mise à jour améliore le rendu visuel du produit dans la vue 3D.

## Objectif

Dans la version précédente, le nuage de points scanner pouvait donner un effet
pixellisé au-dessus du stock. La surface produit est maintenant affichée comme un
maillage plus propre et plus continu, tout en conservant les données d'inventaire
calculées par le backend Python.

## Changements principaux

- Le maillage 3D du stock est sur-échantillonné côté affichage.
- La hauteur reste issue de la grille backend, mais elle est interpolée pour une
  surface plus lisse.
- Les couleurs produit restent liées au catalogue produit.
- Les points scanner deviennent une couche de diagnostic, désactivée par défaut.
- Les points scanner utilisent maintenant un rendu circulaire transparent au lieu
  de carrés très visibles.
- Le bouton `Défaut` dans les couches garde le stock propre et masque les points
  scanner.

## Important

Cette modification est visuelle. Elle ne change pas le calcul du tonnage, du
volume, des jobs de simulation ou des rapports. Le backend Python reste la source
autoritaire pour l'inventaire.

## Comment voir les points scanner

Dans le panneau `COUCHES`, activer :

`Points scanner (debug)`

Cette couche est utile pour expliquer que le scanner lit la surface, mais elle
n'est pas nécessaire pour présenter le stock propre.
