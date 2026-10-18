# Correction de chargement v2.2.1

Cette mise à jour corrige une erreur côté interface qui pouvait empêcher la page de charger au premier affichage.

## Cause

Le panneau de simulation construisait un job par défaut avant que la liste des produits soit disponible. Dans ce cas, le code essayait de lire `product.id` alors que le produit n’était pas encore chargé.

## Correction

- La configuration de job par défaut accepte maintenant l’état temporaire sans produit.
- Les passages sont créés seulement lorsque le catalogue produits est chargé.
- L’affichage du produit actif utilise une couleur de secours pendant le chargement.

Aucun changement backend, aucune donnée et aucun calcul de tonnage ne sont modifiés.
