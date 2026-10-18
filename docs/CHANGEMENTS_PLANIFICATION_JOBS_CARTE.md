# Mise à jour — planification des jobs depuis la carte

Cette évolution est ajoutée à la base existante. Elle reste entièrement en simulation : aucune commande n'est envoyée à un PLC ou à un stacker réel.

## Parcours opérateur

1. Sélectionner un intervalle ou un rectangle dans la vue 2D.
2. Cliquer sur **Créer un job dans cette zone**.
3. Compléter le formulaire du job : produits, tonnages, type de stockage, disposition, hauteur, vitesse et débit.
4. Cliquer sur **Vérifier la capacité** ou **Aperçu avant lancement**.
5. Corriger le job si la validation est refusée, ou accepter la zone libre proposée.
6. Cliquer sur **Valider et lancer le job**.
7. Le stacker se déplace d'abord vers le point de départ sans déposer de matière, puis exécute les passages configurés.

Tous les libellés visibles ajoutés par cette mise à jour sont en français.

## Validation métier

La validation Python vérifie notamment :

- que la zone appartient entièrement à la base choisie ;
- que le stacker peut atteindre tout l'intervalle ;
- que les produits existent dans le catalogue ;
- que le tonnage demandé peut entrer dans le volume disponible ;
- que la hauteur maximale prévue n'est pas dépassée ;
- que le mode **côte à côte** n'utilise pas une zone déjà occupée ;
- que chaque sous-zone produit est suffisamment longue ;
- qu'un intervalle libre peut être proposé lorsqu'un autre emplacement est disponible.

L'aperçu de capacité est un calcul de simulation non certifié. Le tonnage réel du démonstrateur continue à provenir du registre de dépôt simulé.

## Disposition des produits

### Côte à côte

Les produits sont répartis dans des sous-zones longitudinales distinctes, avec un espace entre les phases. Le dépôt est limité aux bornes prévues pour chaque produit.

### En couches

Tous les produits utilisent la même emprise. Les quantités par produit restent additives dans l'inventaire et le dernier produit déposé devient le produit exposé à la surface. Cette mise à jour ne crée pas encore une coupe 3D verticale complète des couches internes.

## Exécution du job

Les états ajoutés sont :

- **Prêt** ;
- **Refusé** ;
- **En déplacement** ;
- **En positionnement** ;
- **En cours** ;
- **En pause** ;
- **Terminé** ;
- **Arrêté** ;
- **Erreur**.

Pendant **En déplacement**, le stacker rejoint le début du passage et aucune matière n'est déposée. Le stockage commence uniquement après l'arrivée au point de départ.

## API ajoutée

```http
POST /api/simulation/jobs/validate
```

Corps :

```json
{
  "config": {
    "name": "Job carte",
    "storage_type": "longitudinal",
    "placement_mode": "adjacent",
    "start_m": 80,
    "end_m": 180,
    "lane": "south",
    "area": {"x0": 80, "x1": 180, "y0": -48, "y1": -14, "source": "map"},
    "max_height_m": 8,
    "travel_speed_m_s": 0.08,
    "flow_t_h": 1800,
    "time_scale": 300,
    "reset_before_start": false,
    "passes": [
      {"product_id": "LAVE-A", "target_tonnage_t": 500, "direction": "forward", "lane": "auto"}
    ]
  }
}
```

La réponse contient les erreurs en français, les métriques d'aperçu, la répartition prévue des passages et, si possible, une zone libre proposée.
