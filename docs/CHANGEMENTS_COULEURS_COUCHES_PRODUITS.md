# Couleurs et sélection des couches produit

Cette mise à jour corrige le cas où le dernier produit déposé colorait toute la surface du stock.

## Modèle de données

Chaque cellule du parc conserve maintenant une pile ordonnée de couches matière :

- produit ;
- hauteur basse ;
- hauteur haute ;
- première et dernière séquence d'acquisition.

Exemple :

- produit A : 0 à 3 m ;
- produit B : 3 à 4 m.

Le produit B ne remplace plus le produit A dans les données.

## Rendu 3D

Le rendu utilise un matériau Three.js distinct par produit. Les couleurs ne sont plus interpolées entre deux produits.
Les faces latérales des couches rendent les produits inférieurs visibles. Le filtre **FILTRE PRODUITS 3D** permet :

- d'afficher tous les produits ;
- de rendre les autres produits transparents ;
- d'isoler un produit et révéler une couche enfouie.

La surface supérieure reste physiquement correcte : le produit supérieur masque le produit inférieur vu du dessus.

## Sélection depuis la carte

Un clic sur un stock en vue 2D ou 3D sélectionne maintenant la cellule de 2 m correspondante.
L'onglet **Inventaire sélection** et le tableau affichent ensuite les produits, tonnages, volumes, densités et analyses présents dans cette cellule.
