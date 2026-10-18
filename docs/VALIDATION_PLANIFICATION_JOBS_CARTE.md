# Validation — planification des jobs depuis la carte

## Tests exécutés

### Backend Python

```text
66 tests réussis
```

Les nouveaux tests couvrent :

- validation d'un job issu d'une sélection cartographique ;
- calcul de l'aperçu de capacité ;
- répartition sans chevauchement de plusieurs produits ;
- refus d'une zone déjà occupée ;
- proposition d'un intervalle libre ;
- refus d'une capacité insuffisante ;
- déplacement du stacker sans dépôt jusqu'au point de départ ;
- dépôt borné à la zone du job ;
- conservation des volumes des produits superposés ;
- exposition du dernier produit déposé à la surface ;
- endpoint API de validation ;
- lancement dans l'état **EN_DEPLACEMENT**.

### Frontend TypeScript

```text
21 fichiers TypeScript/TSX analysés
0 erreur de syntaxe
```

Ce contrôle vérifie la syntaxe, mais pas la résolution complète des dépendances Next.js.

### Géométrie Three.js

```text
12 tests de géométrie réussis
Typage strict du module de géométrie réussi
```

## Limites de la validation locale

- Docker n'est pas disponible dans l'environnement de génération.
- Le build complet Next.js n'a pas été exécuté, car les dépendances npm n'étaient pas disponibles localement.
- La validation finale recommandée sur Windows est :

```powershell
docker compose build --no-cache frontend
docker compose up -d --build --force-recreate
```

## Essai fonctionnel recommandé

1. Démarrer avec un parc vide.
2. Sélectionner 80 à 180 m dans le parc sud.
3. Créer un job depuis la sélection.
4. Ajouter deux produits en mode **Côte à côte**.
5. Vérifier que l'aperçu attribue deux sous-zones non chevauchantes.
6. Lancer le job.
7. Vérifier que le stacker se déplace d'abord vers 80 m sans dépôt.
8. Vérifier ensuite le stockage du premier puis du second produit dans leurs zones respectives.
9. Refaire le test sur une zone occupée et vérifier l'alerte ainsi que la zone libre proposée.
