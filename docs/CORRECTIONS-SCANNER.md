# Mesures scanner : édition sans perte de provenance

## Trois niveaux distincts

**Brut immuable** : instance d'acquisition, identifiant, séquence, horodatage, pose, configuration acquise, angles, distances et qualités reçues. Le journal conserve ce record même après une révision.

**Copie de travail** : distances et qualités saisies dans la fenêtre « Données du scanner ». Elles n'ont aucun effet serveur tant que l'opérateur n'applique pas la correction. Une cellule vide devient `null`, c'est-à-dire aucun retour. Le tableau marque ces rayons « À recalculer ».

**Révision acceptée** : enregistrement append-only avec opérateur déclaré, motif, horodatage de révision, identifiant de révision et liste de modifications. Un même rayon peut avoir plusieurs révisions ; la dernière acceptée s'applique, toutes les précédentes demeurent journalisées. L'opérateur est actuellement déclaratif, pas authentifié.

## Exemple d'import de corrections

Le fichier doit contenir des indices existant dans le balayage ouvert. Le choix d'un index n'est pas transférable sans vérification à un autre balayage.

```json
{
  "updates": [
    { "index": 0, "range_m": null, "quality": 0 },
    { "index": 40, "range_m": 13.25, "quality": 92 }
  ]
}
```

L'exemple illustre uniquement la syntaxe : 13,25 m n'est pas une correction proposée pour votre scanner. L'import ne valide pas automatiquement. Il charge la copie de travail, puis demande un opérateur, un motif et une confirmation. Les doublons d'indices, nombres non finis, indices hors tableau et valeurs hors bornes sont refusés. Taille d'import maximale : 1 Mo ; cette limite UI ne remplace pas les limites de requête d'une future passerelle de production.

## Calcul

Les angles du scanner sont exprimés dans son plan XZ :

```text
x = distance × sin(angle)
y = 0
z = −distance × cos(angle)
```

Le traitement applique les facteurs d'échelle/biais et filtres acquis avec ce scan, puis la chaîne : translation machine → orientation → inclinaison → décalage du montage → rotations de montage. Il utilise **la pose stockée à l'acquisition**, jamais la position actuelle du stacker.

Les mesures révisées réactualisent la grille observée en ordre d'acquisition. Un ancien balayage corrigé ne remplace donc pas une mesure plus récente couvrant la même cellule. Le nuage de rendu garde une fenêtre bornée de retours ; la grille « Surface LiDAR observée » est la projection recalculée à consulter pour les corrections historiques.

Les changements de paramètres dans « Configuration du parc / Scanner » s'appliquent aux acquisitions suivantes. Ils ne remplacent pas la calibration archivée dans les acquisitions antérieures. Cette version n'inclut pas une procédure de recalibration rétroactive validée ; elle devrait être une autre opération versionnée.

## Ce qu'une correction ne peut pas faire

Elle ne change pas l'origine géographique du parc, un horodatage d'acquisition, une identité, la commande d'un équipement réel ou la masse issue du registre des dépôts. Le champ « qualité » est un critère de filtre de démonstration ; il n'ajoute aucune certification métrologique.

Dans un système de production, toute correction devrait être soumise au RBAC, à la validation requise par le procédé et à un véritable historique inviolable. Le journal local de cette version n'est pas protégé contre un administrateur qui le modifie directement sur le disque.
